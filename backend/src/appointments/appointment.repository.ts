import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.tokens';
import { notFound } from '../common/errors';

/**
 * Read model of an appointment (`cita`) as the API exposes it.
 * Timestamps are ISO-8601 UTC strings, as fixed by SPEC.md.
 */
export interface AppointmentRecord {
  id: number;
  patientId: number;
  professionalId: number;
  start: string;
  end: string;
  status: 'scheduled' | 'attended' | 'cancelled' | 'no_show';
  createdAt: string;
  patient: {
    id: number;
    nombre: string;
    apellidos: string;
    documento: string;
  };
  professional: {
    id: number;
    nombre: string;
    apellidos: string;
    especialidad: string;
  };
}

export interface AppointmentRow {
  id: number;
  paciente_id: number;
  profesional_id: number;
  franja_inicio: Date;
  franja_fin: Date;
  estado: AppointmentRecord['status'];
  creada_en: Date;
  paciente_nombre: string;
  paciente_apellidos: string;
  paciente_documento: string;
  profesional_nombre: string;
  profesional_apellidos: string;
  profesional_especialidad: string;
}

export const APPOINTMENT_SELECT = `
  SELECT c.id,
         c.paciente_id,
         c.profesional_id,
         c.franja_inicio,
         c.franja_fin,
         c.estado,
         c.creada_en,
         p.nombre AS paciente_nombre,
         p.apellidos AS paciente_apellidos,
         p.documento AS paciente_documento,
         pr.nombre AS profesional_nombre,
         pr.apellidos AS profesional_apellidos,
         pr.especialidad AS profesional_especialidad
    FROM cita c
    JOIN paciente p ON p.id = c.paciente_id
    JOIN profesional pr ON pr.id = c.profesional_id
`;

export function toAppointmentRecord(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    patientId: row.paciente_id,
    professionalId: row.profesional_id,
    start: row.franja_inicio.toISOString(),
    end: row.franja_fin.toISOString(),
    status: row.estado,
    createdAt: row.creada_en.toISOString(),
    patient: {
      id: row.paciente_id,
      nombre: row.paciente_nombre,
      apellidos: row.paciente_apellidos,
      documento: row.paciente_documento,
    },
    professional: {
      id: row.profesional_id,
      nombre: row.profesional_nombre,
      apellidos: row.profesional_apellidos,
      especialidad: row.profesional_especialidad,
    },
  };
}

/** Runs `work` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
  }
}

@Injectable()
export class AppointmentRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  get connection(): Pool {
    return this.pool;
  }

  async findById(id: number): Promise<AppointmentRecord | undefined> {
    const result = await this.pool.query<AppointmentRow>(`${APPOINTMENT_SELECT} WHERE c.id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : toAppointmentRecord(row);
  }

  async requireById(id: number): Promise<AppointmentRecord> {
    const found = await this.findById(id);
    if (found === undefined) {
      throw notFound('Appointment not found.');
    }
    return found;
  }

  async listForPatient(patientId: number): Promise<AppointmentRecord[]> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.paciente_id = $1
        ORDER BY c.franja_inicio DESC, c.id DESC`,
      [patientId],
    );
    return result.rows.map(toAppointmentRecord);
  }

  async listForProfessional(
    professionalId: number,
    from: Date,
    to: Date,
  ): Promise<AppointmentRecord[]> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.profesional_id = $1
          AND c.franja_inicio >= $2
          AND c.franja_inicio <= $3
        ORDER BY c.franja_inicio ASC, c.id ASC`,
      [professionalId, from.toISOString(), to.toISOString()],
    );
    return result.rows.map(toAppointmentRecord);
  }

  async listForRange(from: Date, to: Date): Promise<AppointmentRecord[]> {
    const result = await this.pool.query<AppointmentRow>(
      `${APPOINTMENT_SELECT}
        WHERE c.franja_inicio >= $1
          AND c.franja_inicio <= $2
        ORDER BY c.franja_inicio ASC, c.id ASC`,
      [from.toISOString(), to.toISOString()],
    );
    return result.rows.map(toAppointmentRecord);
  }

  /** RF-10: a professional may read a patient only with an assigned appointment. */
  async professionalHasAppointment(professionalId: number, patientId: number): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM cita
          WHERE profesional_id = $1
            AND paciente_id = $2
      ) AS exists`,
      [professionalId, patientId],
    );
    return result.rows[0]?.exists === true;
  }

  async patientExists(patientId: number): Promise<boolean> {
    const result = await this.pool.query<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM paciente WHERE id = $1) AS exists',
      [patientId],
    );
    return result.rows[0]?.exists === true;
  }

  async patientIdOfUser(userId: number): Promise<number | undefined> {
    const result = await this.pool.query<{ id: number }>(
      'SELECT id FROM paciente WHERE usuario_id = $1',
      [userId],
    );
    return result.rows[0]?.id;
  }
}
