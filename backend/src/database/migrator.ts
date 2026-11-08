import { Pool, PoolClient } from 'pg';
import { migrations, validateMigrations, Migration } from './migrations';

/**
 * Versioned migration runner (RF-02).
 *
 * - Applied versions are recorded in `public.schema_migrations`
 *   (`version`, `name`, `applied_at`).
 * - Every migration runs inside its own transaction, so a failure leaves the
 *   database on the previous version instead of a half-applied one.
 * - A session-level advisory lock serialises concurrent backends (compose
 *   scale, rolling restarts) so the same migration is never applied twice.
 * - `runMigrationsDown` reverses the applied versions in descending order.
 */

const ADVISORY_LOCK_KEY = 732_451_001;

export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

export interface MigrationResult {
  applied: number[];
  skipped: number[];
}

async function withTransaction(client: PoolClient, work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version integer PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function appliedVersions(client: PoolClient): Promise<number[]> {
  const result = await client.query<{ version: number }>(
    `SELECT version FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version ASC`,
  );
  return result.rows.map((row) => Number(row.version));
}

async function withAdvisoryLock<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
  }
}

/**
 * Applies every pending migration in version order.
 * Idempotent: already-applied versions are skipped.
 */
export async function runMigrations(
  pool: Pool,
  list: readonly Migration[] = migrations,
): Promise<MigrationResult> {
  validateMigrations(list);

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };

  try {
    return await withAdvisoryLock(client, async () => {
      await ensureMigrationsTable(client);
      const done = new Set(await appliedVersions(client));

      for (const migration of list) {
        if (done.has(migration.version)) {
          result.skipped.push(migration.version);
          continue;
        }

        await withTransaction(client, async () => {
          await client.query(migration.up);
          await client.query(
            `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name) VALUES ($1, $2)`,
            [migration.version, migration.name],
          );
        });

        result.applied.push(migration.version);
      }

      return result;
    });
  } finally {
    client.release();
  }
}

/**
 * Reverses applied migrations, newest first. Used by `npm run migrate:down`;
 * it is not part of the start-up path.
 */
export async function runMigrationsDown(
  pool: Pool,
  list: readonly Migration[] = migrations,
  steps = Number.POSITIVE_INFINITY,
): Promise<MigrationResult> {
  validateMigrations(list);
  const byVersion = new Map(list.map((item) => [item.version, item]));

  const client = await pool.connect();
  const result: MigrationResult = { applied: [], skipped: [] };

  try {
    return await withAdvisoryLock(client, async () => {
      await ensureMigrationsTable(client);
      const done = (await appliedVersions(client)).sort((a, b) => b - a);

      let remaining = steps;
      for (const version of done) {
        if (remaining <= 0) {
          break;
        }
        const migration = byVersion.get(version);
        if (!migration) {
          throw new Error(`missing_migration_definition: ${version}`);
        }

        await withTransaction(client, async () => {
          await client.query(migration.down);
          await client.query(`DELETE FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE version = $1`, [version]);
        });

        result.applied.push(version);
        remaining -= 1;
      }

      return result;
    });
  } finally {
    client.release();
  }
}
