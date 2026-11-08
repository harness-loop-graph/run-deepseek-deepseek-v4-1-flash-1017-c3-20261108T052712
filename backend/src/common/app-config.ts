/**
 * Runtime configuration, read exclusively from environment variables
 * (RF-26: no secrets in the repository).
 *
 * Every getter has a documented default that matches `.env.example`, so the
 * backend also starts locally without a `.env` file.
 */

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer in ${name}`);
  }
  return parsed;
}

export interface OAuthConfig {
  /** The only registered public client (SPEC.md, fixed wire formats). */
  clientId: string;
  /** The only registered redirect URI. */
  redirectUri: string;
  /** Access token lifetime: 15 minutes (RF-08). */
  accessTtlSeconds: number;
  /** Refresh token lifetime: 8 hours (RF-08). */
  refreshTtlSeconds: number;
  /** Lifetime of an authorization code. */
  codeTtlSeconds: number;
  /** Pepper used to hash opaque tokens at rest. */
  tokenSecret: string;
}

export function oauthConfig(): OAuthConfig {
  return {
    clientId: readString('OAUTH_CLIENT_ID', 'medapp-spa'),
    redirectUri: readString('OAUTH_REDIRECT_URI', 'http://localhost:8080/auth/callback'),
    accessTtlSeconds: readInt('ACCESS_TOKEN_TTL_SECONDS', 900),
    refreshTtlSeconds: readInt('REFRESH_TOKEN_TTL_SECONDS', 28800),
    codeTtlSeconds: readInt('OAUTH_CODE_TTL_SECONDS', 120),
    tokenSecret: readString('TOKEN_SECRET', 'local-development-token-secret-change-me'),
  };
}

/** Allowed browser origins for the SPA (comma separated in `CORS_ORIGIN`). */
export function corsOrigins(): string[] {
  return readString('CORS_ORIGIN', 'http://localhost:8080')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/** RF-14: auth endpoints 5 req/min per IP, booking 10 req/min per user. */
export function rateLimits(): { authPerMinute: number; bookingPerMinute: number } {
  return {
    authPerMinute: readInt('RATE_LIMIT_AUTH_PER_MINUTE', 5),
    bookingPerMinute: readInt('RATE_LIMIT_BOOKING_PER_MINUTE', 10),
  };
}

/** RF-17: 5 MB per attachment, stored outside any served directory. */
export function maxUploadBytes(): number {
  return readInt('MAX_UPLOAD_BYTES', 5 * 1024 * 1024);
}

export function attachmentsDir(): string {
  return readString('ATTACHMENTS_DIR', '/app/storage/attachments');
}

/** RF-05: password for the deterministic seed and for admin-created users. */
export function seedPassword(): string {
  return readString('SEED_PASSWORD', 'Seed!Passw0rd');
}

export function pageSize(): number {
  return readInt('PAGE_SIZE', 20);
}
