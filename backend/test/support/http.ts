import { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../../src/auth/auth-user';
import { HttpResponse, HttpRequest } from '../../src/common/http.types';

/**
 * Minimal Nest `ExecutionContext` / `ArgumentsHost` stubs.
 *
 * Guards and the exception filter only use the HTTP adapter surface, so the
 * tests drive them with plain objects and assert on the recorded response.
 */

export interface RecordedResponse extends HttpResponse {
  statusCode: number;
  body: unknown;
  sent: string | Buffer | undefined;
  headers: Record<string, string | number | string[]>;
}

export function createResponse(): RecordedResponse {
  const response: RecordedResponse = {
    headersSent: false,
    statusCode: 200,
    body: undefined,
    sent: undefined,
    headers: {},
    setHeader(name: string, value: string | number | string[]): void {
      response.headers[name] = value;
    },
    status(code: number): HttpResponse {
      response.statusCode = code;
      return response;
    },
    json(body: unknown): void {
      response.body = body;
      response.headersSent = true;
    },
    send(body: string | Buffer): void {
      response.sent = body;
      response.headersSent = true;
    },
    end(): void {
      response.headersSent = true;
    },
  };
  return response;
}

export function createRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'GET',
    url: '/',
    headers: {},
    params: {},
    query: {},
    body: undefined,
    ...overrides,
  };
}

export interface ContextOptions {
  handler?: () => unknown;
  controller?: new (...args: never[]) => unknown;
  request?: HttpRequest;
  response?: RecordedResponse;
}

export function createContext(options: ContextOptions = {}): ExecutionContext {
  const request = options.request ?? createRequest();
  const response = options.response ?? createResponse();
  const handler = options.handler ?? ((): void => undefined);
  const controller = options.controller ?? class TestController {};

  const http = {
    getRequest: <T>() => request as unknown as T,
    getResponse: <T>() => response as unknown as T,
  };

  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => http,
    getArgs: () => [request, response],
    getArgByIndex: (index: number) => (index === 0 ? request : response),
    switchToRpc: () => ({ getData: () => undefined, getContext: () => undefined }),
    switchToWs: () => ({ getClient: () => undefined, getData: () => undefined }),
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

export function createHost(request: HttpRequest, response: RecordedResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as unknown as T,
      getResponse: <T>() => response as unknown as T,
      getNext: <T>() => undefined as unknown as T,
    }),
    getArgs: () => [request, response],
    getArgByIndex: () => request,
    switchToRpc: () => ({ getData: () => undefined, getContext: () => undefined }),
    switchToWs: () => ({ getClient: () => undefined, getData: () => undefined }),
    getType: () => 'http',
  } as unknown as ArgumentsHost;
}

export function patientUser(id = 1, patientId = 1): AuthUser {
  return { userId: id, email: `paciente${id}@seed.local`, roles: ['patient'], patientId };
}

export function professionalUser(id = 6, professionalId = 1): AuthUser {
  return { userId: id, email: `pro${id}@seed.local`, roles: ['professional'], professionalId };
}

export function staffUser(id = 2): AuthUser {
  return { userId: id, email: 'staff@seed.local', roles: ['staff'] };
}

export function adminUser(id = 1): AuthUser {
  return { userId: id, email: 'admin@seed.local', roles: ['admin'] };
}
