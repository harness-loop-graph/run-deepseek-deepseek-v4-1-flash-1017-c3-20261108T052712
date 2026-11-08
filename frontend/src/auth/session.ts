import { apiRequest, setTokenProvider } from '../api/client';
import { toApiError } from '../api/errors';
import { fetchAgenda, listOwnAppointments, listUsers } from '../api/endpoints';
import type { IssuedTokens, RoleName } from '../api/types';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  MIN_REFRESH_DELAY_MS,
  OAUTH_CLIENT_ID,
  OAUTH_REDIRECT_URI,
  PROACTIVE_REFRESH_RATIO,
} from '../config';

/**
 * Session and token policy of the SPA (RF-08, RF-23).
 *
 * - The access token (15 min) lives in memory only; the refresh token (8 h) is
 *   mirrored in `sessionStorage` so a page reload does not lose the session.
 * - A proactive refresh is scheduled at 80 % of the access lifetime; a `401`
 *   from any request triggers one refresh-and-retry, then the session ends.
 * - Logout calls EP-04 and clears every trace of the token pair.
 *
 * The identity of the caller (roles, patient/professional profile) is resolved
 * once per session from the API itself: the access token is opaque, so the
 * server — never the UI — decides which role the session holds (RF-09).
 */

export type SessionStatus = 'initializing' | 'anonymous' | 'authenticated' | 'failed';

export interface Identity {
  roles: RoleName[];
  /** The role that drives navigation and the landing route (RF-20). */
  primaryRole: RoleName;
  patientId?: number;
  professionalId?: number;
  email?: string;
}

export interface SessionSnapshot {
  status: SessionStatus;
  identity?: Identity;
  error?: string;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

const REFRESH_STORAGE_KEY = 'medapp.session.refresh';
const IDENTITY_STORAGE_KEY = 'medapp.session.identity';
const ROLE_PRIORITY: readonly RoleName[] = ['admin', 'professional', 'staff', 'patient'];

function primaryRoleOf(roles: RoleName[]): RoleName {
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) {
      return role;
    }
  }
  return 'patient';
}

function readStoredIdentity(): Identity | undefined {
  const raw = sessionStorage.getItem(IDENTITY_STORAGE_KEY);
  if (raw === null) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const roles = Array.isArray(record.roles)
      ? record.roles.filter((role): role is RoleName => typeof role === 'string')
      : [];
    if (roles.length === 0) {
      return undefined;
    }
    return {
      roles,
      primaryRole:
        typeof record.primaryRole === 'string' ? (record.primaryRole as RoleName) : primaryRoleOf(roles),
      patientId: typeof record.patientId === 'number' ? record.patientId : undefined,
      professionalId: typeof record.professionalId === 'number' ? record.professionalId : undefined,
      email: typeof record.email === 'string' ? record.email : undefined,
    };
  } catch {
    return undefined;
  }
}

function storeIdentity(identity: Identity): void {
  sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

interface ProbeResult<T> {
  ok: boolean;
  value?: T;
  status: number;
}

async function probe<T>(work: () => Promise<T>): Promise<ProbeResult<T>> {
  try {
    return { ok: true, value: await work(), status: 200 };
  } catch (error) {
    return { ok: false, status: toApiError(error).status };
  }
}

/**
 * Resolves the role of the fresh session from the API. Each probe is a real
 * authorization check on the server, so a role can never be assumed by the UI.
 *
 * - `GET /admin/users` → 200 means `admin`.
 * - `GET /me/appointments` → 200 means `patient` (and yields the profile id).
 * - `GET /agenda` → 200 means `professional`; a 422 (`professionalId` required
 *   for a non-professional caller) means `staff`.
 */
export async function resolveIdentity(): Promise<Identity> {
  const admin = await probe(() => listUsers(1));
  if (admin.ok) {
    return { roles: ['admin'], primaryRole: 'admin' };
  }

  const patient = await probe(() => listOwnAppointments());
  if (patient.ok) {
    const patientId = patient.value?.[0]?.patientId;
    return { roles: ['patient'], primaryRole: 'patient', patientId };
  }

  const agenda = await probe(() => fetchAgenda(undefined, undefined));
  if (agenda.ok) {
    const professionalId = agenda.value?.flatMap((day) => day.appointments)[0]?.professionalId;
    return { roles: ['professional'], primaryRole: 'professional', professionalId };
  }
  if (agenda.status === 422) {
    return { roles: ['staff'], primaryRole: 'staff' };
  }

  if (admin.status === 401 || patient.status === 401 || agenda.status === 401) {
    throw new Error('The session is no longer valid.');
  }
  throw new Error('The role of this session could not be determined.');
}

class SessionStore {
  private tokens: Tokens | undefined;

  private snapshot: SessionSnapshot = { status: 'initializing' };

  private readonly listeners = new Set<() => void>();

  private refreshInFlight: Promise<boolean> | undefined;

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private started = false;

  constructor() {
    setTokenProvider({
      accessToken: () => this.tokens?.accessToken,
      refresh: () => this.refresh(),
      onUnauthenticated: () => this.clear('The session has expired. Sign in again.'),
    });
  }

  getSnapshot = (): SessionSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  accessToken(): string | undefined {
    return this.tokens?.accessToken;
  }

  /** Boots the session from `sessionStorage` (a reload keeps the session). */
  async initialize(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;

    const refreshToken = sessionStorage.getItem(REFRESH_STORAGE_KEY);
    if (refreshToken === null || refreshToken === '') {
      this.publish({ status: 'anonymous' });
      return;
    }

    const refreshed = await this.refreshWith(refreshToken);
    if (!refreshed) {
      this.publish({ status: 'anonymous' });
      return;
    }

    const cached = readStoredIdentity();
    if (cached !== undefined) {
      this.publish({ status: 'authenticated', identity: cached });
      return;
    }
    await this.loadIdentity();
  }

  /** EP-02: exchanges the authorization code and starts the session. */
  async completeAuthorization(code: string, codeVerifier: string): Promise<Identity> {
    const issued = await apiRequest<IssuedTokens>('/auth/token', {
      method: 'POST',
      authenticated: false,
      body: {
        code,
        code_verifier: codeVerifier,
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
      },
    });
    this.storeTokens(issued);
    return this.loadIdentity();
  }

  /** EP-04: revokes the session server-side and clears local state. */
  async logout(): Promise<void> {
    const refreshToken = this.tokens?.refreshToken ?? sessionStorage.getItem(REFRESH_STORAGE_KEY);
    this.clear(undefined);
    if (refreshToken === null || refreshToken === undefined || refreshToken === '') {
      return;
    }
    try {
      await apiRequest<void>('/auth/revoke', {
        method: 'POST',
        authenticated: false,
        body: { refresh_token: refreshToken },
      });
    } catch {
      // A revocation failure must never keep the local session alive; the
      // token pair is already gone from this browser.
    }
  }

  /** Updates the cached profile id once a screen has discovered it. */
  patchIdentity(patch: Partial<Identity>): void {
    const current = this.snapshot.identity;
    if (current === undefined) {
      return;
    }
    const next: Identity = { ...current, ...patch };
    storeIdentity(next);
    this.publish({ ...this.snapshot, identity: next });
  }

  /** Single-flight refresh used by the API client on a 401 (RF-23). */
  async refresh(): Promise<boolean> {
    const refreshToken = this.tokens?.refreshToken ?? sessionStorage.getItem(REFRESH_STORAGE_KEY);
    if (refreshToken === null || refreshToken === undefined || refreshToken === '') {
      return false;
    }
    if (this.refreshInFlight !== undefined) {
      return this.refreshInFlight;
    }
    this.refreshInFlight = this.refreshWith(refreshToken).finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async refreshWith(refreshToken: string): Promise<boolean> {
    try {
      const issued = await apiRequest<IssuedTokens>('/auth/token/refresh', {
        method: 'POST',
        authenticated: false,
        body: { refresh_token: refreshToken },
      });
      this.storeTokens(issued);
      return true;
    } catch {
      this.tokens = undefined;
      sessionStorage.removeItem(REFRESH_STORAGE_KEY);
      sessionStorage.removeItem(IDENTITY_STORAGE_KEY);
      return false;
    }
  }

  private async loadIdentity(): Promise<Identity> {
    try {
      const identity = await resolveIdentity();
      storeIdentity(identity);
      this.publish({ status: 'authenticated', identity });
      return identity;
    } catch (error) {
      this.clear(toApiError(error).message);
      throw error;
    }
  }

  private storeTokens(issued: IssuedTokens): void {
    const now = Date.now();
    const accessTtl = (issued.expires_in ?? ACCESS_TOKEN_TTL_SECONDS) * 1000;
    const refreshTtl = issued.refresh_expires_in ?? undefined;
    this.tokens = {
      accessToken: issued.access_token,
      refreshToken: issued.refresh_token,
      accessExpiresAt: now + accessTtl,
      refreshExpiresAt: now + (refreshTtl ?? 8 * 60 * 60) * 1000,
    };
    sessionStorage.setItem(REFRESH_STORAGE_KEY, issued.refresh_token);
    this.scheduleProactiveRefresh();
  }

  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.tokens === undefined) {
      return;
    }
    const lifetime = this.tokens.accessExpiresAt - Date.now();
    const delay = Math.max(MIN_REFRESH_DELAY_MS, Math.floor(lifetime * PROACTIVE_REFRESH_RATIO));
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delay);
  }

  private clear(error: string | undefined): void {
    this.tokens = undefined;
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    sessionStorage.removeItem(REFRESH_STORAGE_KEY);
    sessionStorage.removeItem(IDENTITY_STORAGE_KEY);
    this.publish({ status: 'anonymous', error });
  }

  private publish(snapshot: SessionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const session = new SessionStore();

/** Landing route of a role (RF-20). */
export function homeRouteFor(identity: Identity | undefined): string {
  switch (identity?.primaryRole) {
    case 'admin':
      return '/admin';
    case 'professional':
      return '/agenda';
    case 'staff':
      return '/agenda';
    case 'patient':
    default:
      return '/appointments';
  }
}
