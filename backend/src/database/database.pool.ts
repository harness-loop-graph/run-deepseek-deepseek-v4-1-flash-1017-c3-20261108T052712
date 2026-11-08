import { Pool } from 'pg';
import { DatabaseConfig, loadDatabaseConfig } from './database.config';

/**
 * Builds the single `pg` pool used by the backend (RF-01..RF-06).
 * No ORM: every query is explicit SQL and the schema only comes from the
 * versioned migrations in `./migrations`.
 */
export function createPool(config: DatabaseConfig = loadDatabaseConfig()): Pool {
  const pool = config.connectionString
    ? new Pool({
        connectionString: config.connectionString,
        max: config.max,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        idleTimeoutMillis: config.idleTimeoutMillis,
      })
    : new Pool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        max: config.max,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
        idleTimeoutMillis: config.idleTimeoutMillis,
      });

  pool.on('error', (error: Error) => {
    // Never rethrow: an idle client error must not crash the process.
    console.error(`[database] idle client error: ${error.message}`);
  });

  return pool;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits until PostgreSQL accepts a trivial query. Compose starts the backend
 * only after the `db` healthcheck passes, but a retry loop keeps a manual
 * `docker compose up backend` (or a slow volume init) working too.
 */
export async function waitForDatabase(
  pool: Pool,
  attempts = 30,
  delayMs = 1000,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  const reason = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`database_unavailable: ${reason}`);
}
