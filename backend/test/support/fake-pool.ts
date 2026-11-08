import type { Pool } from 'pg';

/**
 * In-memory `pg` stand-in for the unit tests.
 *
 * The tests exercise authorization, validation, the booking transaction and
 * the token policy without a running PostgreSQL: each fake answers the exact
 * SQL the service issues and records what was asked. `connect()` models a
 * transaction, and `BEGIN` serialises transactions through a mutex, which is
 * how the tests reproduce the row-level lock of EP-07 (RF-13).
 */

export interface QueryResult {
  rows: unknown[];
  rowCount: number;
}

export type QueryHandler = (params: unknown[]) => QueryResult | Promise<QueryResult>;

interface Route {
  pattern: RegExp;
  handler: QueryHandler;
}

export function rows(items: unknown[]): QueryResult {
  return { rows: items, rowCount: items.length };
}

export function empty(): QueryResult {
  return { rows: [], rowCount: 0 };
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    await previous;
    return release;
  }
}

export interface FakeClient {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
  release(): void;
}

export class FakePool {
  private readonly routes: Route[] = [];
  private readonly mutex = new Mutex();
  readonly statements: string[] = [];

  /** Registers a handler for every statement matching `pattern` (first wins). */
  on(pattern: RegExp, handler: QueryHandler): this {
    this.routes.push({ pattern, handler });
    return this;
  }

  /** Registers a constant result. */
  answer(pattern: RegExp, result: QueryResult): this {
    return this.on(pattern, () => result);
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    return this.dispatch(sql, params);
  }

  async connect(): Promise<FakeClient> {
    let release: (() => void) | undefined;
    const pool = this;

    return {
      async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
        const text = sql.trim();
        if (/^BEGIN$/i.test(text)) {
          release = await pool.mutex.acquire();
          pool.statements.push('BEGIN');
          return empty();
        }
        if (/^(COMMIT|ROLLBACK)$/i.test(text)) {
          pool.statements.push(text.toUpperCase());
          release?.();
          release = undefined;
          return empty();
        }
        return pool.dispatch(sql, params);
      },
      release(): void {
        release?.();
        release = undefined;
      },
    };
  }

  /** Number of transactions opened so far. */
  transactions(): number {
    return this.statements.filter((statement) => statement === 'BEGIN').length;
  }

  private dispatch(sql: string, params: unknown[]): QueryResult | Promise<QueryResult> {
    this.statements.push(sql.trim().split('\n')[0].trim());
    for (const route of this.routes) {
      if (route.pattern.test(sql)) {
        return route.handler(params);
      }
    }
    return empty();
  }
}

/** The fake pool satisfies every collaborator that expects a `pg` Pool. */
export function asPool(pool: FakePool): Pool {
  return pool as unknown as Pool;
}
