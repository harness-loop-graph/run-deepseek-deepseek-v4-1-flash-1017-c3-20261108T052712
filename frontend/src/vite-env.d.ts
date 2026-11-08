/// <reference types="vite/client" />

/**
 * Build-time configuration baked into the bundle by Vite (see `.env.example`
 * and the `frontend` service in `docker-compose.yml`).
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_OAUTH_CLIENT_ID?: string;
  readonly VITE_OAUTH_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
