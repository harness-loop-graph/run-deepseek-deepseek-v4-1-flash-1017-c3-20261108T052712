import { API_BASE_URL } from '../config';
import { ApiError, apiErrorFromResponse, toApiError } from './errors';

/**
 * REST client of the SPA (EP-01 .. EP-19).
 *
 * Every request goes through `authorizedFetch`, which attaches the bearer
 * access token and applies the RF-23 policy: a single 401 triggers one
 * refresh-and-retry, and a second 401 ends the session. Failures are always
 * normalised to an `ApiError` carrying the server envelope
 * `{ error: { code, message } }` (RF-16), so a screen can display the server
 * message verbatim (RF-21).
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  /** JSON body; ignored when `formData` is set. */
  body?: unknown;
  /** Multipart body (EP-13); the browser sets the boundary. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Defaults to true: send the bearer token and refresh on 401. */
  authenticated?: boolean;
}

/** The session manager implements this and registers itself at import time. */
export interface TokenProvider {
  accessToken(): string | undefined;
  /** Resolves true when a new access token was obtained (single flight). */
  refresh(): Promise<boolean>;
  /** Called when the session can no longer be used. */
  onUnauthenticated(): void;
}

let tokenProvider: TokenProvider | undefined;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = /^https?:\/\//i.test(API_BASE_URL)
    ? API_BASE_URL
    : `${window.location.origin}${API_BASE_URL}`;
  const url = new URL(`${base}${normalized}`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function send(path: string, options: RequestOptions, token: string | undefined): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: BodyInit | undefined;

  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
    // The API authenticates with bearer tokens, never with cookies.
    credentials: 'omit',
    cache: 'no-store',
  });
}

async function authorizedFetch(path: string, options: RequestOptions): Promise<Response> {
  const authenticated = options.authenticated !== false;
  let token = authenticated ? tokenProvider?.accessToken() : undefined;
  let response = await send(path, options, token);

  if (response.status === 401 && authenticated && tokenProvider !== undefined) {
    const refreshed = await tokenProvider.refresh();
    if (refreshed) {
      response = await send(path, options, tokenProvider.accessToken());
    }
    if (response.status === 401) {
      tokenProvider.onUnauthenticated();
      throw await apiErrorFromResponse(response);
    }
  }

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }
  return response;
}

async function readJson<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (text.trim() === '') {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  try {
    const response = await authorizedFetch(path, options);
    return await readJson<T>(response);
  } catch (error) {
    throw toApiError(error);
  }
}

/** Binary read (EP-14); the bytes never touch an unauthenticated URL. */
export async function apiDownload(path: string, options: RequestOptions = {}): Promise<Blob> {
  try {
    const response = await authorizedFetch(path, options);
    return await response.blob();
  } catch (error) {
    throw toApiError(error);
  }
}

export { ApiError };
