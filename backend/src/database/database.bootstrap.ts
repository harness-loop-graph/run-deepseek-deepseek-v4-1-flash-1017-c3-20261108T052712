import { Pool } from 'pg';
import { createPool, waitForDatabase } from './database.pool';
import { runMigrations } from './migrator';
import { runSeed } from './seed/seed.runner';

/**
 * Start-up wiring for the data layer (RF-02, RF-05, RF-27).
 *
 * The backend calls this once before opening the HTTP listener, so a 200 from
 * `GET /health` implies a migrated and seeded schema. The operation is
 * idempotent: repeated starts apply nothing and insert nothing.
 */
export interface DatabaseInitResult {
  pool: Pool;
  migrationsApplied: number[];
  migrationsSkipped: number[];
  seed: {
    roles: number;
    users: number;
    patients: number;
    professionals: number;
    availability: number;
  };
}

export async function initializeDatabase(pool: Pool): Promise<DatabaseInitResult> {
  await waitForDatabase(pool);

  const migrations = await runMigrations(pool);
  const seed = await runSeed(pool);

  return {
    pool,
    migrationsApplied: migrations.applied,
    migrationsSkipped: migrations.skipped,
    seed,
  };
}

/**
 * Convenience wrapper for `main.ts`: builds the pool from the environment,
 * initialises the schema and returns the ready pool.
 */
export async function bootstrapDatabase(): Promise<DatabaseInitResult> {
  const pool = createPool();
  try {
    return await initializeDatabase(pool);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}
