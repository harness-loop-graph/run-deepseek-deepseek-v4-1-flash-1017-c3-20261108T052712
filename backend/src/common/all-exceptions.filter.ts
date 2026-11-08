import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AppException, ERROR_CODES } from './errors';
import { HttpResponse } from './http.types';

/**
 * Global exception filter (RF-16).
 *
 * Every failure leaves the process as `{ "error": { "code", "message" } }`.
 * The message is either one we wrote ourselves (`AppException`) or a generic
 * message derived from the status code: framework messages, driver messages,
 * stack traces, SQL and file system paths never reach the client. The full
 * error is logged server-side only.
 */
interface Envelope {
  status: number;
  code: string;
  message: string;
  headers?: Record<string, string>;
}

const DEFAULT_MESSAGES: Record<number, { code: string; message: string }> = {
  400: { code: ERROR_CODES.invalidRequest, message: 'The request is invalid.' },
  401: { code: ERROR_CODES.unauthorized, message: 'Authentication required.' },
  403: { code: ERROR_CODES.forbidden, message: 'You are not allowed to perform this operation.' },
  404: { code: ERROR_CODES.notFound, message: 'Resource not found.' },
  409: { code: ERROR_CODES.conflict, message: 'The operation conflicts with the current state.' },
  413: { code: ERROR_CODES.payloadTooLarge, message: 'The uploaded file exceeds the allowed size.' },
  415: { code: ERROR_CODES.unsupportedMediaType, message: 'Unsupported media type.' },
  422: { code: ERROR_CODES.validation, message: 'The request payload is invalid.' },
  429: { code: ERROR_CODES.rateLimited, message: 'Too many requests. Retry later.' },
  500: { code: ERROR_CODES.internal, message: 'Unexpected server error.' },
};

function defaultsFor(status: number): { code: string; message: string } {
  const known = DEFAULT_MESSAGES[status];
  if (known !== undefined) {
    return known;
  }
  if (status >= 500) {
    return DEFAULT_MESSAGES[500];
  }
  return { code: ERROR_CODES.invalidRequest, message: 'The request could not be processed.' };
}

/**
 * Defensive check: a message we did not author could contain a stack frame, a
 * SQL fragment or a path. Such a message is replaced by the status default.
 */
export function isSafeMessage(message: string): boolean {
  if (message.trim() === '' || message.length > 300) {
    return false;
  }
  const forbidden = [/at\s+\w+\s+\(/, /select\s/i, /insert\s+into/i, /\/app\//i, /\/home\//i, /\.ts:\d+/, /\n/];
  return !forbidden.some((pattern) => pattern.test(message));
}

function envelopeFrom(exception: unknown): Envelope {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof HttpException) {
    // Framework and parser exceptions (Nest's router, multer, the JSON body
    // parser) carry messages we did not author: they may quote a route, a
    // header or a parser detail. Only our own envelope shape is trusted; every
    // other status keeps its generic message (RF-16).
    const status = exception.getStatus();
    const fallback = defaultsFor(status);
    const payload = exception.getResponse();
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (
        typeof record.code === 'string' &&
        (Object.values(ERROR_CODES) as string[]).includes(record.code) &&
        typeof record.message === 'string' &&
        isSafeMessage(record.message)
      ) {
        return { status, code: record.code, message: record.message };
      }
    }
    return { status, code: fallback.code, message: fallback.message };
  }

  return { status: HttpStatus.INTERNAL_SERVER_ERROR, ...DEFAULT_MESSAGES[500] };
}

function retryAfterFrom(exception: unknown): Record<string, string> | undefined {
  if (exception instanceof HttpException) {
    const payload = exception.getResponse();
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (typeof record.retryAfterSeconds === 'number' && record.retryAfterSeconds > 0) {
        return { 'Retry-After': String(Math.ceil(record.retryAfterSeconds)) };
      }
    }
  }
  return undefined;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    const request = host.switchToHttp().getRequest<{ method?: string; url?: string }>();

    const envelope = envelopeFrom(exception);
    const headers = retryAfterFrom(exception);

    if (envelope.status >= 500) {
      const detail = exception instanceof Error ? `${exception.name}: ${exception.message}` : 'unknown error';
      this.logger.error(
        `${request.method ?? '?'} ${request.url ?? '?'} -> ${envelope.status} (${detail})`,
      );
    }

    if (response.headersSent) {
      return;
    }

    if (headers !== undefined) {
      for (const [name, value] of Object.entries(headers)) {
        response.setHeader(name, value);
      }
    }

    response.status(envelope.status).json({
      error: { code: envelope.code, message: envelope.message },
    });
  }
}
