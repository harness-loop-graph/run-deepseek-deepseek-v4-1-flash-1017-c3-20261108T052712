import { Global, Inject, Injectable, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { createPool, waitForDatabase } from './database.pool';
import { DATABASE_POOL } from './database.tokens';
import { runMigrations } from './migrator';
import { runSeed } from './seed/seed.runner';

export { DATABASE_POOL };

/**
 * Owns the `pg` pool and the start-up data layer work (RF-02, RF-05, RF-27).
 *
 * `onModuleInit` runs the migrations and the deterministic seed before the
 * HTTP listener accepts traffic, so `GET /health` answering 200 implies a
 * usable schema. Both steps are idempotent.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async onModuleInit(): Promise<void> {
    await waitForDatabase(this.pool);
    const migrations = await runMigrations(this.pool);
    const seed = await runSeed(this.pool);
    console.log(
      `[database] migrations applied=[${migrations.applied.join(',')}] skipped=[${migrations.skipped.join(',')}]`,
    );
    console.log(
      `[database] seed roles=${seed.roles} users=${seed.users} patients=${seed.patients} ` +
        `professionals=${seed.professionals} availability=${seed.availability}`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  get connection(): Pool {
    return this.pool;
  }
}

/**
 * Global module: every domain module can inject `DATABASE_POOL` (or
 * `DatabaseService`) without re-importing anything.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: (): Pool => createPool(),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DatabaseService],
})
export class DatabaseModule {}
