import { AuthUser } from '../auth/auth-user';

/**
 * Minimal structural types for the Express objects Nest hands to controllers.
 *
 * The backend deliberately does not depend on `@types/express`: the few
 * members it uses are declared here, which keeps the runtime dependencies of
 * the image small and makes the streaming/redirect paths explicit.
 */
export interface HttpRequest {
  method: string;
  url: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  user?: AuthUser;
}

export interface HttpResponse {
  headersSent: boolean;
  setHeader(name: string, value: string | number | string[]): void;
  getHeader?(name: string): string | number | string[] | undefined;
  status(code: number): HttpResponse;
  json(body: unknown): void;
  send(body: string | Buffer): void;
  end(): void;
}

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Client IP used by the auth rate limiter (RF-14). */
export function clientIp(request: HttpRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim() !== '') {
    return forwarded.split(',')[0].trim();
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

/** Sends a 302 without depending on Express' `redirect` helper. */
export function redirect(response: HttpResponse, location: string): void {
  response.status(302);
  response.setHeader('Location', location);
  response.end();
}

export function sendHtml(response: HttpResponse, status: number, html: string): void {
  response.status(status);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.send(html);
}
