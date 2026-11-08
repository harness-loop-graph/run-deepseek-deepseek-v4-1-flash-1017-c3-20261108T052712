import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { conflict, notFound, validationError } from '../common/errors';
import { AppointmentRecord, toAppointmentRecord } from '../appointments/appointment.repository';
import { APPOINTMENT_SELECT, AppointmentRow } from '../appointments/appointment.repository';

/**
 * Availability and agenda reads (EP-06, EP-09, EP-18).
 *
 * A slot is offered when it exists in `disponibilidad` and no active
 * appointment (`estado <> 'cancelled'`) occupies it. The same predicate is
 * enforced by the partial unique index, so the read model and the write path
 * can never disagree (RF-03, RF-13).
 */

export interface Slot {
  start: string;
  end: string;
}

export interface AgendaDay {
  date: string;
  appointments: AppointmentRecord[];
}

interface SlotRow {
  franja_inicio: Date;
  franja_fin: Date;
}

interface ProfessionalRow {
  id: number;
  usuario_id: number;
  nombre: string;
  apellidos: string;
  especialidad: string;
}

export interface ProfessionalSummary {
  id: number;
  nombre: string;
  apellidos: string;
  especialidad: string;
}

export interface AgendaRow extends AppointmentRow {}

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async professionalExists(professionalId: number): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM profesional WHERE id = $1) AS exists',
      [professionalId],
    );
    return result.rows[0]?.exists === true;
  }

  async professionalIdOfUser(userId: number): Promise<number | undefined> {
    const result = await this.pool.query<{ id: number }>(
      'SELECT id FROM profesional WHERE usuario_id = $1',
      [userId],
    );
    return result.rows[0]?.id;
  }

  async listProfessionals(): Promise<ProfessionalSummary[]> {
    const result = await this.pool.query<ProfessionalRow>(
      `SELECT id, usuario_id, nombre, apellidos, especialidad
         FROM profesional
        ORDER BY apellidos ASC, nombre ASC`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      nombre: row.nombre,
      apellidos: row.apellidos,
      especialidad: row.especialidad,
    }));
  }

  /** EP-06: free slots of a professional in a date range. */
  async freeSlots(professionalId: number, start: Date, end: Date): Promise<Slot[]> {
    if (start.getTime() > end.getTime()) {
      throw validationError('query: "from" must not be after "to"');
    }
    if (!(await this.professionalExists(professionalId))) {
      throw notFound('Professional not found.');
    }

    const result = await this.pool.query<SlotRow>(
      `SELECT d.franja_inicio, d.franja_fin
         FROM disponibilidad d
        WHERE d.profesional_id = $1
          AND d.franja_inicio >= $2
          AND d.franja_inicio <= $3
          AND NOT EXISTS (
            SELECT 1
              FROM cita c
             WHERE c.profesional_id = d.profesional_id
               AND c.franja_inicio = d.franja_inicio
               AND c.estado <> 'cancelled'
          )
        ORDER BY d.franja_inicio ASC`,
      [professionalId, start.toISOString(), end.toISOString()],
    );

    return result.rows.map((row) => ({
      start: row.franja_inicio.toISOString(),
      end: row.franja_fin.toISOString(),
    }));
  }

  /** EP-09: the professional's appointments grouped by UTC day. */
  async agenda(professionalId: number, start: Date, end: Date): Promise<AgendaDay[]> {
    if (start.getTime() > end.getTime()) {
      throw validationError('query: "from" must not be after "to"');
    }

    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.profesional_id = $1
          AND c.franja_inicio >= $2
          AND c.franja_inicio <= $3
        ORDER BY c.franja_inicio ASC, c.id ASC`,
      [professionalId, start.toISOString(), end.toISOString()],
    );

    const days = new Map<string, AppointmentRecord[]>();
    for (const row of result.rows) {
      const appointment = toAppointmentRecord(row);
      const date = appointment.start.slice(0, 10);
      const bucket = days.get(date) ?? [];
      bucket.push(appointment);
      days.set(date, bucket);
    }

    return [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, appointments]) => ({ date, appointments }));
  }

  /**
   * EP-18: replaces the whole slot set of a professional inside one
   * transaction. Overlapping input slots and slots already booked are a 422
   * (the replacement cannot silently drop an active appointment).
   */
  async replaceAvailability(professionalId: number, slots: Slot[]): Promise<Slot[]> {
    if (!(await this.professionalExists(professionalId))) {
      throw notFound('Professional not found.');
    }

    const parsed = slots
      .map((slot) => ({ start: new Date(slot.start), end: new Date(slot.end) }))
      .map((slot) => {
        if (slot.end.getTime() <= slot.start.getTime()) {
          throw validationError('body.slots: "end" must be after "start"');
        }
        return slot;
      })
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (let index = 1; index < parsed.length; index += 1) {
      const previous = parsed[index - 1];
      const current = parsed[index];
      if (current.start.getTime() < previous.end.getTime()) {
        throw validationError('body.slots: slots must not overlap');
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Slots holding an active appointment are kept: replacing availability
      // must never silently detach a booked appointment from the agenda.
      await client.query(
        `DELETE FROM disponibilidad d
          WHERE d.profesional_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM cita c
               WHERE c.profesional_id = d.profesional_id
                 AND c.franja_inicio = d.franja_inicio
                 AND c.estado <> 'cancelled'
            )`,
        [professionalId],
      );

      for (const slot of parsed) {
        await client.query(
          `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
           VALUES ($1, $2, $3)
           ON CONFLICT (profesional_id, franja_inicio) DO NOTHING`,
          [professionalId, slot.start.toISOString(), slot.end.toISOString()],
        );
      }

      const stored = await client.query<SlotRow>(
        `SELECT franja_inicio, franja_fin
           FROM disponibilidad
          WHERE profesional_id = $1
          ORDER BY franja_inicio ASC`,
        [professionalId],
      );

      await client.query('COMMIT');
      return stored.rows.map((row) => ({
        start: row.franja_inicio.toISOString(),
        end: row.franja_fin.toISOString(),
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
