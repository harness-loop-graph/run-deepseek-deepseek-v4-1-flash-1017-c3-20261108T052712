/**
 * Error handling of the SPA (RF-16, RF-21).
 *
 * The backend always answers a failure with the envelope
 * `{ "error": { "code", "message" } }`. The client keeps that pair on a typed
 * error, so a screen can show the server message verbatim (`error-banner`)
 * without ever inventing one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

export interface EnvelopeBody {
  code: string;
  message: string;
}

function fallbackFor(status: number): EnvelopeBody {
  if (status === 0) {
    return {
      code: 'network_error',
      message: 'The API could not be reached. Check that the backend is running.',
    };
  }
  return {
    code: `http_${status}`,
    message: `The request failed with status ${status}.`,
  };
}

/** Reads `{ error: { code, message } }` defensively; never trusts the shape. */
export function envelopeFromPayload(payload: unknown, status: number): EnvelopeBody {
  const fallback = fallbackFor(status);
  if (typeof payload !== 'object' || payload === null) {
    return fallback;
  }
  const envelope = (payload as ErrorEnvelope).error;
  if (typeof envelope !== 'object' || envelope === null) {
    return fallback;
  }
  const code = typeof envelope.code === 'string' && envelope.code !== '' ? envelope.code : fallback.code;
  const message =
    typeof envelope.message === 'string' && envelope.message.trim() !== ''
      ? envelope.message
      : fallback.message;
  return { code, message };
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  const { code, message } = envelopeFromPayload(payload, response.status);
  return new ApiError(response.status, code, message);
}

/** Normalises anything thrown by a loader into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  const message = error instanceof Error ? error.message : 'Unexpected error.';
  return new ApiError(0, 'unexpected_error', message);
}

export function describeError(error: unknown): string {
  return toApiError(error).message;
}
