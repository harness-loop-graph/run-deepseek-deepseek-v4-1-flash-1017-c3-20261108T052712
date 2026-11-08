import { Pool, PoolClient } from 'pg';
import { hashPassword, verifyPassword } from './password';
import {
  SEED_AVAILABILITY,
  SEED_PATIENTS,
  SEED_PASSWORD_DEFAULT,
  SEED_PROFESSIONALS,
  SEED_ROLES,
  SEED_USERS,
} from './seed.data';

/**
 * Deterministic, idempotent seed (RF-05).
 *
 * Every insert targets the natural key of the row, so re-running the seed on
 * every backend start neither duplicates nor reorders anything:
 *
 * - `rol`               → `ON CONFLICT (nombre)`
 * - `usuario`           → `ON CONFLICT (lower(email))`
 * - `usuario_rol`       → `ON CONFLICT (usuario_id, rol_id)`
 * - `paciente`          → `ON CONFLICT (usuario_id)`
 * - `profesional`       → `ON CONFLICT (usuario_id)`
 * - `disponibilidad`    → `ON CONFLICT (profesional_id, franja_inicio)`
 *
 * Ids are identity columns assigned in insertion order, so a fresh database
 * always yields patients 1..3 and professionals 1..2.
 */

const SEED_ADVISORY_LOCK_KEY = 732_451_002;

export interface SeedOptions {
  /** Plaintext password for every seeded user; defaults to `SEED_PASSWORD`. */
  password?: string;
  /** Clock used to anchor the availability window; defaults to now. */
  now?: Date;
}

export interface SeedResult {
  roles: number;
  users: number;
  patients: number;
  professionals: number;
  availability: number;
}

interface AvailabilitySlot {
  start: Date;
  end: Date;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function resolvePassword(options: SeedOptions): string {
  const fromOptions = options.password?.trim();
  if (fromOptions) {
    return options.password as string;
  }
  const fromEnv = process.env.SEED_PASSWORD;
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return fromEnv;
  }
  return SEED_PASSWORD_DEFAULT;
}

/** UTC midnight of the seed day; the availability window is anchored here. */
function utcMidnight(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

function weekdayAvailability(worksFridays: boolean, now: Date): AvailabilitySlot[] {
  const config = SEED_AVAILABILITY;
  const base = utcMidnight(now);
  const slots: AvailabilitySlot[] = [];

  for (let dayOffset = 0; dayOffset < config.days; dayOffset += 1) {
    const dayStart = new Date(base.getTime() + dayOffset * DAY_MS);
    const weekday = dayStart.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const isFriday = weekday === config.friday;
    if (isWeekend || (isFriday && !worksFridays)) {
      continue;
    }

    for (
      let minute = config.firstSlotMinute;
      minute < config.lastSlotMinute;
      minute += config.slotMinutes
    ) {
      const start = new Date(dayStart.getTime() + minute * MINUTE_MS);
      const end = new Date(start.getTime() + config.slotMinutes * MINUTE_MS);
      slots.push({ start, end });
    }
  }

  return slots;
}

async function insertRoles(client: PoolClient): Promise<number> {
  let inserted = 0;
  for (const nombre of SEED_ROLES) {
    const result = await client.query(
      'INSERT INTO rol (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING',
      [nombre],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function insertUsers(client: PoolClient, password: string): Promise<number> {
  let inserted = 0;
  let passwordHash: string | undefined;
  const currentHash = async (): Promise<string> => {
    passwordHash = passwordHash ?? (await hashPassword(password));
    return passwordHash;
  };

  for (const user of SEED_USERS) {
    const existing = await client.query<{ id: number; password_hash: string }>(
      'SELECT id, password_hash FROM usuario WHERE lower(email) = lower($1)',
      [user.email],
    );
    const current = existing.rows[0];

    if (current === undefined) {
      await client.query('INSERT INTO usuario (email, password_hash) VALUES ($1, $2)', [
        user.email,
        await currentHash(),
      ]);
      inserted += 1;
    } else if (!(await verifyPassword(password, current.password_hash))) {
      // The row keeps tracking the configured `SEED_PASSWORD` across restarts;
      // a matching hash is left untouched so repeated starts write nothing.
      await client.query('UPDATE usuario SET password_hash = $2 WHERE id = $1', [
        current.id,
        await currentHash(),
      ]);
    }

    const found = await client.query<{ id: number }>(
      'SELECT id FROM usuario WHERE lower(email) = lower($1)',
      [user.email],
    );
    const usuarioId = found.rows[0]?.id;
    if (usuarioId === undefined) {
      throw new Error(`seed_user_not_found: ${user.email}`);
    }

    for (const role of user.roles) {
      await client.query(
        `INSERT INTO usuario_rol (usuario_id, rol_id)
         SELECT $1, id FROM rol WHERE nombre = $2
         ON CONFLICT (usuario_id, rol_id) DO NOTHING`,
        [usuarioId, role],
      );
    }
  }
  return inserted;
}

async function userIdByEmail(client: PoolClient, email: string): Promise<number> {
  const found = await client.query<{ id: number }>(
    'SELECT id FROM usuario WHERE lower(email) = lower($1)',
    [email],
  );
  const id = found.rows[0]?.id;
  if (id === undefined) {
    throw new Error(`seed_user_not_found: ${email}`);
  }
  return id;
}

async function insertPatients(client: PoolClient): Promise<number> {
  let inserted = 0;
  for (const patient of SEED_PATIENTS) {
    const usuarioId = await userIdByEmail(client, patient.email);
    const result = await client.query(
      `INSERT INTO paciente (usuario_id, nombre, apellidos, documento, fecha_nacimiento)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (usuario_id) DO NOTHING`,
      [usuarioId, patient.nombre, patient.apellidos, patient.documento, patient.fechaNacimiento],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function insertProfessionals(client: PoolClient): Promise<number> {
  let inserted = 0;
  for (const professional of SEED_PROFESSIONALS) {
    const usuarioId = await userIdByEmail(client, professional.email);
    const result = await client.query(
      `INSERT INTO profesional (usuario_id, nombre, apellidos, especialidad)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id) DO NOTHING`,
      [usuarioId, professional.nombre, professional.apellidos, professional.especialidad],
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

async function insertAvailability(client: PoolClient, now: Date): Promise<number> {
  let inserted = 0;
  for (const professional of SEED_PROFESSIONALS) {
    const usuarioId = await userIdByEmail(client, professional.email);
    const found = await client.query<{ id: number }>(
      'SELECT id FROM profesional WHERE usuario_id = $1',
      [usuarioId],
    );
    const profesionalId = found.rows[0]?.id;
    if (profesionalId === undefined) {
      throw new Error(`seed_professional_not_found: ${professional.email}`);
    }

    for (const slot of weekdayAvailability(professional.worksFridays, now)) {
      const result = await client.query(
        `INSERT INTO disponibilidad (profesional_id, franja_inicio, franja_fin)
         VALUES ($1, $2, $3)
         ON CONFLICT (profesional_id, franja_inicio) DO NOTHING`,
        [profesionalId, slot.start.toISOString(), slot.end.toISOString()],
      );
      inserted += result.rowCount ?? 0;
    }
  }
  return inserted;
}

/**
 * Seeds roles, users, patients, professionals and availability in one
 * transaction, serialised by an advisory lock so concurrent backends cannot
 * interleave their inserts.
 */
export async function runSeed(pool: Pool, options: SeedOptions = {}): Promise<SeedResult> {
  const password = resolvePassword(options);
  const now = options.now ?? new Date();

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SEED_ADVISORY_LOCK_KEY]);
    await client.query('BEGIN');
    try {
      const result: SeedResult = {
        roles: await insertRoles(client),
        users: await insertUsers(client, password),
        patients: await insertPatients(client),
        professionals: await insertProfessionals(client),
        availability: await insertAvailability(client, now),
      };
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SEED_ADVISORY_LOCK_KEY]).catch(
      () => undefined,
    );
    client.release();
  }
}
