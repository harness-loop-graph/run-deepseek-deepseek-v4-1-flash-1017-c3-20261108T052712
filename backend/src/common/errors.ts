import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Stable machine codes of the error envelope (RF-11, RF-16).
 * Every response failure is shaped as `{ "error": { "code", "message" } }`.
 */
export const ERROR_CODES = {
  validation: 'validation_error',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  payloadTooLarge: 'payload_too_large',
  unsupportedMediaType: 'unsupported_media_type',
  rateLimited: 'rate_limited',
  invalidRequest: 'invalid_request',
  invalidGrant: 'invalid_grant',
  internal: 'internal_error',
} as const;

/**
 * Application error carrying both the HTTP status and the stable envelope
 * code. Messages are always written by us (never a database message), so a
 * response can never leak SQL, a stack trace or a file system path (RF-16).
 */
export class AppException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
  ) {
    super({ code, message }, status);
  }
}

export function validationError(message: string): AppException {
  return new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ERROR_CODES.validation, message);
}

export function unauthorized(message = 'Authentication required.'): AppException {
  return new AppException(HttpStatus.UNAUTHORIZED, ERROR_CODES.unauthorized, message);
}

export function forbidden(message = 'You are not allowed to perform this operation.'): AppException {
  return new AppException(HttpStatus.FORBIDDEN, ERROR_CODES.forbidden, message);
}

export function notFound(message = 'Resource not found.'): AppException {
  return new AppException(HttpStatus.NOT_FOUND, ERROR_CODES.notFound, message);
}

export function conflict(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ERROR_CODES.conflict, message);
}

export function payloadTooLarge(message = 'The uploaded file exceeds the allowed size.'): AppException {
  return new AppException(HttpStatus.PAYLOAD_TOO_LARGE, ERROR_CODES.payloadTooLarge, message);
}

export function unsupportedMediaType(message = 'Unsupported file type.'): AppException {
  return new AppException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, ERROR_CODES.unsupportedMediaType, message);
}

/**
 * 429 with the `Retry-After` hint of RF-14. The filter turns
 * `retryAfterSeconds` into the header; it is never part of the body envelope.
 */
export class RateLimitException extends AppException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.rateLimited, message);
  }

  override getResponse(): Record<string, unknown> {
    return { code: ERROR_CODES.rateLimited, message: this.message, retryAfterSeconds: this.retryAfterSeconds };
  }
}

export function rateLimited(
  message = 'Too many requests. Retry later.',
  retryAfterSeconds = 60,
): AppException {
  return new RateLimitException(message, retryAfterSeconds);
}

export function invalidRequest(message: string): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ERROR_CODES.invalidRequest, message);
}

export function invalidGrant(message: string): AppException {
  return new AppException(HttpStatus.UNAUTHORIZED, ERROR_CODES.invalidGrant, message);
}
