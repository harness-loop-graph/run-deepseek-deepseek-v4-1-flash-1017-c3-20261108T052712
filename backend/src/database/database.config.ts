/**
 * Database configuration derived exclusively from environment variables
 * (RF-26: no secrets in the repository).
 *
 * Precedence:
 *   1. DATABASE_URL (used by docker compose)
 *   2. libpq variables: PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
 *   3. POSTGRES_* variables (same names as the official postgres image)
 *   4. local development defaults (localhost / medapp)
 */
export interface DatabaseConfig {
  connectionString?: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  max: number;
  ssl: boolean;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value for ${name}`);
  }
  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw;
}

export function loadDatabaseConfig(): DatabaseConfig {
  const connectionString = process.env.DATABASE_URL?.trim();

  return {
    connectionString: connectionString ? connectionString : undefined,
    host: readString('PGHOST', readString('POSTGRES_HOST', 'localhost')),
    port: readInt('PGPORT', readInt('POSTGRES_PORT', 5432)),
    user: readString('PGUSER', readString('POSTGRES_USER', 'medapp')),
    password: readString('PGPASSWORD', readString('POSTGRES_PASSWORD', 'medapp')),
    database: readString('PGDATABASE', readString('POSTGRES_DB', 'medapp')),
    max: readInt('DATABASE_POOL_MAX', 10),
    ssl: readBoolean('DATABASE_SSL', false),
    connectionTimeoutMillis: readInt('DATABASE_CONNECT_TIMEOUT_MS', 5000),
    idleTimeoutMillis: readInt('DATABASE_IDLE_TIMEOUT_MS', 30000),
  };
}
