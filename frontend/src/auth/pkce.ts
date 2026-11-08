/**
 * PKCE (RFC 7636, S256) helpers of the SPA (RF-07, RF-18).
 *
 * The verifier is generated in the browser, kept in `sessionStorage` while the
 * user is on the authorization server, and only sent to EP-02. Only the
 * SHA-256 challenge ever travels through the authorization request (EP-01).
 */

const VERIFIER_BYTES = 32;
const STATE_BYTES = 32;
const PENDING_KEY = 'medapp.pkce.pending';

export interface PendingAuthorization {
  codeVerifier: string;
  state: string;
  createdAt: number;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A 43-character verifier from the unreserved set (RFC 7636 §4.1). */
export function createCodeVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** An unpredictable `state` value (RF-18: the callback verifies it). */
export function createState(): string {
  const bytes = new Uint8Array(STATE_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** `BASE64URL(SHA256(ASCII(code_verifier)))`. */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export interface AuthorizationRequest {
  codeVerifier: string;
  state: string;
  codeChallenge: string;
}

/** Generates a fresh verifier/challenge/state triple and stores the secret. */
export async function startAuthorization(): Promise<AuthorizationRequest> {
  const codeVerifier = createCodeVerifier();
  const state = createState();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  const pending: PendingAuthorization = { codeVerifier, state, createdAt: Date.now() };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  return { codeVerifier, state, codeChallenge };
}

export function readPendingAuthorization(): PendingAuthorization | undefined {
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (raw === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (typeof record.codeVerifier !== 'string' || typeof record.state !== 'string') {
      return undefined;
    }
    return {
      codeVerifier: record.codeVerifier,
      state: record.state,
      createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
    };
  } catch {
    return undefined;
  }
}

export function clearPendingAuthorization(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
