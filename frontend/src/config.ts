/**
 * Build-time configuration of the SPA.
 *
 * The values are baked into the bundle by Vite from `VITE_*` environment
 * variables (see `.env.example` and the `frontend` build args in
 * `docker-compose.yml`). The defaults match the fixed delivery contract:
 * API at http://localhost:3000, public client `medapp-spa`, redirect URI
 * `http://localhost:8080/auth/callback` (SPEC.md).
 */

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export const API_BASE_URL = withoutTrailingSlash(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
);

/** The only registered public OAuth client (RF-07). */
export const OAUTH_CLIENT_ID = import.meta.env.VITE_OAUTH_CLIENT_ID ?? 'medapp-spa';

/** The only registered redirect URI; the SPA handles `/auth/callback`. */
export const OAUTH_REDIRECT_URI =
  import.meta.env.VITE_OAUTH_REDIRECT_URI ?? 'http://localhost:8080/auth/callback';

/** RF-08: access token 15 min, refresh token 8 h. */
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/**
 * RF-23: proactive refresh. The access token is refreshed once 80 % of its
 * lifetime has elapsed (about 12 minutes), never earlier than 5 seconds.
 */
export const PROACTIVE_REFRESH_RATIO = 0.8;
export const MIN_REFRESH_DELAY_MS = 5_000;

/** RF-17: the only accepted attachment types. */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
