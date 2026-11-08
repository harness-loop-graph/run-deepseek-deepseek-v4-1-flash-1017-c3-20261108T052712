import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import {
  conflict,
  forbidden,
  notFound,
  validationError,
} from '../common/errors';
import { AuthUser, canReadAppointmentAsPatient, canReadAppointmentAsProfessional } from '../auth/auth-user';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import {
  APPOINTMENT_SELECT,
  AppointmentRecord,
  AppointmentRow,
  toAppointmentRecord,
} from './appointment.repository';

/**
 * Appointments (EP-05, EP-07, EP-08, EP-10, EP-11).
 *
 * Every read applies the RF-10 isolation rule inside the query (`WHERE
 * paciente_id = …` / `WHERE profesional_id = …`), so a caller can never widen
 * their scope by guessing an id.
 */

export interface EncounterRecord {
  id: number;
  appointmentId: number;
  version: number;
  notes: string;
  diagnosis: string;
  authorProfessionalId: number;
  replacesId: number | null;
  createdAt: string;
  attachments: AttachmentSummary[];
}

export interface AttachmentSummary {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface EncounterRow {
  id: number;
  cita_id: number;
  version: number;
  notas: string;
  diagnostico: string;
  autor_profesional_id: number;
  reemplaza_a_id: number | null;
  creado_en: Date;
}

interface AttachmentRow {
  id: number;
  encuentro_id: number;
  nombre_original: string;
  mime_type: string;
  tamano_bytes: number;
  creado_en: Date;
}

export interface AppointmentDetail extends AppointmentRecord {
  encounters: EncounterRecord[];
}

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  /** EP-05: the caller patient's own appointments. */
  async listOwnAppointments(user: AuthUser): Promise<AppointmentRecord[]> {
    const patientId = user.patientId;
    if (patientId === undefined) {
      throw forbidden('The caller has no patient profile.');
    }

    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.paciente_id = $1
        ORDER BY c.franja_inicio DESC, c.id DESC`,
      [patientId],
    );

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.appointmentsRead,
      resourceType: 'cita',
      resourceId: null,
      metadata: { scope: 'own', count: result.rowCount ?? 0 },
    });

    return result.rows.map(toAppointmentRecord);
  }

  /**
   * EP-07 (RF-13): transactional booking.
   *
   * The availability row is locked with `SELECT … FOR UPDATE`, then the
   * active appointment of that slot is checked and the row inserted inside the
   * same transaction. A concurrent booking of the same slot waits on the lock,
   * re-reads the committed appointment and receives a 409; the partial unique
   * index `cita_slot_activo_uq` is the final backstop.
   */
  async book(user: AuthUser, professionalId: number, slotStart: string): Promise<{ id: number }> {
    const patientId = user.patientId;
    if (patientId === undefined) {
      throw forbidden('Only a patient can book an appointment.');
    }

    const slot = new Date(slotStart);
    if (Number.isNaN(slot.getTime())) {
      throw validationError('body.slotStart: must be a valid ISO-8601 timestamp');
    }
    if (slot.getTime() < Date.now()) {
      throw validationError('body.slotStart: the slot is in the past');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const availability = await client.query<{ franja_fin: Date }>(
        `SELECT franja_fin
           FROM disponibilidad
          WHERE profesional_id = $1
            AND franja_inicio = $2
          FOR UPDATE`,
        [professionalId, slot.toISOString()],
      );
      const slotRow = availability.rows[0];
      if (slotRow === undefined) {
        throw validationError('body.slotStart: the professional has no availability at that time');
      }

      const taken = await client.query<{ id: number }>(
        `SELECT id
           FROM cita
          WHERE profesional_id = $1
            AND franja_inicio = $2
            AND estado <> 'cancelled'`,
        [professionalId, slot.toISOString()],
      );
      if (taken.rowCount !== 0) {
        throw conflict('The slot is already booked.');
      }

      const inserted = await client.query<{ id: number }>(
        `INSERT INTO cita (paciente_id, profesional_id, franja_inicio, franja_fin, estado)
         VALUES ($1, $2, $3, $4, 'scheduled')
         ON CONFLICT (profesional_id, franja_inicio) WHERE estado <> 'cancelled' DO NOTHING
         RETURNING id`,
        [patientId, professionalId, slot.toISOString(), slotRow.franja_fin.toISOString()],
      );
      const created = inserted.rows[0];
      if (created === undefined) {
        throw conflict('The slot is already booked.');
      }

      await client.query('COMMIT');

      await this.audit.recordFor(user, {
        action: AUDIT_ACTIONS.appointmentCreated,
        resourceType: 'cita',
        resourceId: created.id,
        metadata: { professionalId, patientId },
      });

      return { id: created.id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (isUniqueViolation(error)) {
        throw conflict('The slot is already booked.');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** EP-08: a patient cancels one of their own appointments (204). */
  async cancel(user: AuthUser, appointmentId: number): Promise<void> {
    const appointment = await this.requireAppointment(appointmentId);

    if (!canReadAppointmentAsPatient(user, appointment.patientId)) {
      throw forbidden('You can only cancel your own appointments.');
    }
    if (appointment.status === 'cancelled') {
      throw conflict('The appointment is already cancelled.');
    }

    await this.pool.query(
      `UPDATE cita
          SET estado = 'cancelled',
              cancelada_en = now(),
              actualizada_en = now()
        WHERE id = $1
          AND estado <> 'cancelled'`,
      [appointmentId],
    );

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.appointmentCancelled,
      resourceType: 'cita',
      resourceId: appointmentId,
      metadata: { professionalId: appointment.professionalId },
    });
  }

  /** EP-10: appointment detail, with clinical content for authorised readers. */
  async detail(user: AuthUser, appointmentId: number): Promise<AppointmentDetail> {
    const appointment = await this.requireAppointment(appointmentId);
    this.assertCanReadAppointment(user, appointment);

    const encounters = await this.encountersFor(appointmentId);

    await this.audit.recordFor(user, {
      action: AUDIT_ACTIONS.encounterRead,
      resourceType: 'cita',
      resourceId: appointmentId,
      metadata: { encounters: encounters.length },
    });

    return { ...appointment, encounters };
  }

  /**
   * EP-11: the assigned professional records (or corrects) the encounter.
   *
   * RF-06: a correction is a new row with `version = previous + 1` that
   * references the replaced row; nothing is ever updated or deleted.
   */
  async recordEncounter(
    user: AuthUser,
    appointmentId: number,
    notes: string,
    diagnosis: string,
  ): Promise<EncounterRecord> {
    const appointment = await this.requireAppointment(appointmentId);

    const professionalId = user.professionalId;
    if (
      professionalId === undefined ||
      !canReadAppointmentAsProfessional(user, appointment.professionalId)
    ) {
      throw forbidden('Only the assigned professional can record this encounter.');
    }
    if (appointment.status === 'cancelled') {
      throw conflict('The appointment is cancelled.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const previous = await client.query<{ id: number; version: number }>(
        `SELECT id, version
           FROM encuentro
          WHERE cita_id = $1
          ORDER BY version DESC
          LIMIT 1
          FOR UPDATE`,
        [appointmentId],
      );
      const last = previous.rows[0];
      const version = last === undefined ? 1 : last.version + 1;

      const inserted = await client.query<EncounterRow>(
        `INSERT INTO encuentro
           (cita_id, version, notas, diagnostico, autor_profesional_id, reemplaza_a_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, cita_id, version, notas, diagnostico, autor_profesional_id,
                   reemplaza_a_id, creado_en`,
        [appointmentId, version, notes, diagnosis, professionalId, last?.id ?? null],
      );

      await client.query(
        `UPDATE cita SET estado = 'attended', actualizada_en = now() WHERE id = $1 AND estado = 'scheduled'`,
        [appointmentId],
      );

      await client.query('COMMIT');

      const row = inserted.rows[0];
      await this.audit.recordFor(user, {
        action: AUDIT_ACTIONS.encounterCreated,
        resourceType: 'encuentro',
        resourceId: row.id,
        metadata: { appointmentId, version },
      });

      return toEncounterRecord(row, []);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** RF-10 guard used by EP-10/EP-11 (a professional only reads assigned ones). */
  assertCanReadAppointment(user: AuthUser, appointment: AppointmentRecord): void {
    if (canReadAppointmentAsPatient(user, appointment.patientId)) {
      return;
    }
    if (canReadAppointmentAsProfessional(user, appointment.professionalId)) {
      return;
    }
    throw forbidden('You are not allowed to read this appointment.');
  }

  async requireAppointment(appointmentId: number): Promise<AppointmentRecord> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT} WHERE c.id = $1`,
      [appointmentId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw notFound('Appointment not found.');
    }
    return toAppointmentRecord(row);
  }

  /** Latest version of every encounter of the appointment, with attachments. */
  async encountersFor(appointmentId: number): Promise<EncounterRecord[]> {
    const result = await this.pool.query<EncounterRow>(
      `SELECT id, cita_id, version, notas, diagnostico, autor_profesional_id, reemplaza_a_id, creado_en
         FROM encuentro
        WHERE cita_id = $1
        ORDER BY version ASC, id ASC`,
      [appointmentId],
    );
    if (result.rowCount === 0) {
      return [];
    }

    const attachments = await this.attachmentsFor(result.rows.map((row) => row.id));
    return result.rows.map((row) => toEncounterRecord(row, attachments.get(row.id) ?? []));
  }

  async attachmentsFor(encounterIds: number[]): Promise<Map<number, AttachmentSummary[]>> {
    const grouped = new Map<number, AttachmentSummary[]>();
    if (encounterIds.length === 0) {
      return grouped;
    }

    const result = await this.pool.query<AttachmentRow>(
      `SELECT id, encuentro_id, nombre_original, mime_type, tamano_bytes, creado_en
         FROM adjunto
        WHERE encuentro_id = ANY($1::int[])
        ORDER BY creado_en ASC, id ASC`,
      [encounterIds],
    );

    for (const row of result.rows) {
      const bucket = grouped.get(row.encuentro_id) ?? [];
      bucket.push({
        id: row.id,
        filename: row.nombre_original,
        mimeType: row.mime_type,
        sizeBytes: row.tamano_bytes,
        createdAt: row.creado_en.toISOString(),
      });
      grouped.set(row.encuentro_id, bucket);
    }
    return grouped;
  }
}

export function toEncounterRecord(
  row: EncounterRow,
  attachments: AttachmentSummary[],
): EncounterRecord {
  return {
    id: row.id,
    appointmentId: row.cita_id,
    version: row.version,
    notes: row.notas,
    diagnosis: row.diagnostico,
    authorProfessionalId: row.autor_profesional_id,
    replacesId: row.reemplaza_a_id,
    createdAt: row.creado_en.toISOString(),
    attachments,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
