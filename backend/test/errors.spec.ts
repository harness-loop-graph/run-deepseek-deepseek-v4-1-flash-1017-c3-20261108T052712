import { describe, expect, it } from 'vitest';
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter, isSafeMessage } from '../src/common/all-exceptions.filter';
import {
  AppException,
  ERROR_CODES,
  conflict,
  forbidden,
  notFound,
  payloadTooLarge,
  rateLimited,
  unauthorized,
  unsupportedMediaType,
  validationError,
} from '../src/common/errors';
import { createHost, createRequest, createResponse } from './support/http';

/**
 * RF-16: no stack trace, SQL fragment or file system path in any response.
 *
 * Every failure leaves the process as `{ error: { code, message } }` with a
 * message we authored, or the generic message of its status. The tests push
 * hostile messages through the filter (framework errors, driver errors, thrown
 * strings) and assert on the exact envelope.
 */

function runFilter(exception: unknown): ReturnType<typeof createResponse> {
  const response = createResponse();
  const host = createHost(createRequest({ method: 'POST', url: '/appointments' }), response);
  new AllExceptionsFilter().catch(exception, host);
  return response;
}

interface Envelope {
  error: { code: string; message: string };
}

function envelopeOf(response: ReturnType<typeof createResponse>): Envelope {
  return response.body as Envelope;
}

const FORBIDDEN_FRAGMENTS = [
  'at ',
  'select ',
  'insert into',
  '/app/',
  '/home/',
  '.ts:',
  'node_modules',
  'pg',
  'stack',
  'Error:',
];

function expectClean(message: string): void {
  for (const fragment of FORBIDDEN_FRAGMENTS) {
    expect(message.toLowerCase()).not.toContain(fragment.toLowerCase());
  }
}

describe('error envelope (RF-11, RF-16)', () => {
  it('maps an application error to its status and code', () => {
    const response = runFilter(forbidden());

    expect(response.statusCode).toBe(403);
    expect(envelopeOf(response)).toEqual({
      error: { code: ERROR_CODES.forbidden, message: 'You are not allowed to perform this operation.' },
    });
  });

  it('maps validation, conflict, not found, 413 and 415', () => {
    expect(runFilter(validationError('body.name: is required')).statusCode).toBe(422);
    expect(runFilter(conflict('The slot is already booked.')).statusCode).toBe(409);
    expect(runFilter(notFound()).statusCode).toBe(404);
    expect(runFilter(payloadTooLarge()).statusCode).toBe(413);
    expect(runFilter(unsupportedMediaType()).statusCode).toBe(415);
    expect(runFilter(unauthorized()).statusCode).toBe(401);
  });

  it('never leaks a SQL fragment from a driver error', () => {
    const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (profesional_id, franja_inicio)=(1, 2030-01-07) already exists.',
      stack: 'Error: duplicate key\n    at /app/dist/appointments/service.js:120:9\nselect * from cita',
    });

    const response = runFilter(driverError);
    expect(response.statusCode).toBe(500);
    expect(envelopeOf(response)).toEqual({
      error: { code: ERROR_CODES.internal, message: 'Unexpected server error.' },
    });
    expectClean(JSON.stringify(response.body));
  });

  it('never leaks a file system path from a thrown string', () => {
    const response = runFilter(new Error('ENOENT: no such file or directory, open /app/storage/x.pdf'));
    expect(response.statusCode).toBe(500);
    expectClean(JSON.stringify(response.body));
  });

  it('keeps framework messages out of the body', () => {
    const response = runFilter(new BadRequestException('Unexpected token in JSON at position 3'));
    expect(response.statusCode).toBe(400);
    expect(envelopeOf(response).error.code).toBe(ERROR_CODES.invalidRequest);
    expect(envelopeOf(response).error.message).toBe('The request is invalid.');
  });

  it('uses the status default for an unknown 404 exception', () => {
    const response = runFilter(new NotFoundException('Cannot GET /secret/path'));
    expect(response.statusCode).toBe(404);
    expect(envelopeOf(response).error.message).toBe('Resource not found.');
  });

  it('turns an unknown throw into a generic 500', () => {
    const response = runFilter({ weird: true });
    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expectClean(JSON.stringify(response.body));
  });

  it('adds Retry-After to a 429 without leaking it into the body', () => {
    const response = runFilter(rateLimited('Too many requests. Retry later.', 42));

    expect(response.statusCode).toBe(429);
    expect(response.headers['Retry-After']).toBe('42');
    expect(envelopeOf(response)).toEqual({
      error: { code: ERROR_CODES.rateLimited, message: 'Too many requests. Retry later.' },
    });
    expect(JSON.stringify(response.body)).not.toContain('retryAfterSeconds');
  });

  it('does not write a body when the headers were already sent', () => {
    const response = createResponse();
    response.headersSent = true;
    const host = createHost(createRequest(), response);

    new AllExceptionsFilter().catch(new HttpException('late', 500), host);
    expect(response.body).toBeUndefined();
  });
});

describe('isSafeMessage', () => {
  it('accepts a message we authored', () => {
    expect(isSafeMessage('The slot is already booked.')).toBe(true);
  });

  it('rejects stack frames, SQL, paths and newlines', () => {
    expect(isSafeMessage('    at Service.book (/app/dist/x.js:1:1)')).toBe(false);
    expect(isSafeMessage('SELECT * FROM usuario')).toBe(false);
    expect(isSafeMessage('INSERT INTO usuario VALUES (1)')).toBe(false);
    expect(isSafeMessage('open /app/storage/a.pdf failed')).toBe(false);
    expect(isSafeMessage('/home/user/project/file.ts:12')).toBe(false);
    expect(isSafeMessage('line one\nline two')).toBe(false);
    expect(isSafeMessage('x'.repeat(400))).toBe(false);
    expect(isSafeMessage('   ')).toBe(false);
  });
});

describe('AppException contract', () => {
  it('carries the status and the stable code', () => {
    const error = new AppException(418, 'teapot', 'Short and stout.');
    expect(error.getStatus()).toBe(418);
    expect(error.code).toBe('teapot');
    expect(error.getResponse()).toEqual({ code: 'teapot', message: 'Short and stout.' });
  });
});
