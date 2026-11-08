/**
 * Command line entry point for the data layer:
 *
 *   npm run migrate:up     apply every pending migration
 *   npm run migrate:down   reverse the last applied migration
 *   npm run seed           run the deterministic seed (idempotent)
 *
 * The backend itself runs both on start; the CLI exists for operators and for
 * the reverse-migration path (RF-02).
 */
import { createPool, waitForDatabase } from './database.pool';
import { runMigrations, runMigrationsDown } from './migrator';
import { runSeed } from './seed/seed.runner';

async function main(): Promise<void> {
  const command = (process.argv[2] ?? '').trim();
  const pool = createPool();

  try {
    await waitForDatabase(pool);

    switch (command) {
      case 'up': {
        const result = await runMigrations(pool);
        console.log(`applied=[${result.applied.join(',')}] skipped=[${result.skipped.join(',')}]`);
        break;
      }
      case 'down': {
        const result = await runMigrationsDown(pool, undefined, 1);
        console.log(`reverted=[${result.applied.join(',')}]`);
        break;
      }
      case 'seed': {
        const result = await runSeed(pool);
        console.log(
          `roles=${result.roles} users=${result.users} patients=${result.patients} ` +
            `professionals=${result.professionals} availability=${result.availability}`,
        );
        break;
      }
      default:
        throw new Error('usage: cli.ts <up|down|seed>');
    }
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown error';
  console.error(`[database] command failed: ${message}`);
  process.exitCode = 1;
});
