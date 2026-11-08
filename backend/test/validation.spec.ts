import { describe, expect, it } from 'vitest';
import { AppException } from '../src/common/errors';
import {
  arrayOf,
  integer,
  object,
  optional,
  query,
  required,
  string,
} from '../src/common/validation';
import { bookAppointmentSchema } from '../src/appointments/appointment.dto';
import { availabilityQuerySchema } from '../src/availability/availability.dto';
import { auditQuerySchema } from '../src/admin/admin.dto';
import { authorizeQuerySchema, tokenRequestSchema } from '../src/auth/auth.dto';
import { encounterSchema } from '../src/appointments/appointment.dto';

/**
 * RF-12: schema validation at the boundary.
 *
 * Every endpoint parses its input through a strict schema; an undeclared field
 * is a 422 and never silently ignored. The tests also pin the fixed wire
 * formats of SPEC.md (`YYYY-MM-DD`, ISO-8601, the EP-01 query).
 */

function statusOf(error: unknown): number | undefined {
  return error instanceof AppException ? error.getStatus() : undefined;
}

function codeOf(error: unknown): string | undefined {
  return error instanceof AppException ? error.code : undefined;
}

describe('strict object schema (RF-12)', () => {
  it('rejects an undeclared field with 422', () => {
    const schema = object<{ name: string }>({ name: required(string()) });

    expect(() => schema.parse({ name: 'ok', admin: true })).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
    try {
      schema.parse({ name: 'ok', admin: true });
    } catch (error) {
      expect(statusOf(error)).toBe(422);
      expect(codeOf(error)).toBe('validation_error');
    }
  });

  it('accepts the declared fields', () => {
    const schema = object<{ name: string; age?: number }>({
      name: required(string()),
      age: optional(integer({ min: 0 })),
    });

    expect(schema.parse({ name: 'Ana' })).toEqual({ name: 'Ana' });
    expect(schema.parse({ name: 'Ana', age: 30 })).toEqual({ name: 'Ana', age: 30 });
  });

  it('rejects a missing required field with 422', () => {
    const schema = object<{ name: string }>({ name: required(string()) });
    expect(() => schema.parse({})).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects an undeclared query parameter with 422', () => {
    expect(() => availabilityQuerySchema.parse({ professionalId: '1', role: 'admin' }, 'query'))
      .toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });

  it('rejects a repeated query parameter', () => {
    expect(() => auditQuerySchema.parse({ action: ['a', 'b'] }, 'query')).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });
});

describe('EP-01 / EP-02 wire formats', () => {
  const authorize = {
    response_type: 'code',
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
    state: 'xyz',
  };

  it('accepts the fixed authorization query', () => {
    expect(authorizeQuerySchema.parse(authorize, 'query')).toMatchObject({ response_type: 'code' });
  });

  it('rejects an undeclared authorization query parameter', () => {
    expect(() => authorizeQuerySchema.parse({ ...authorize, scope: 'openid' }, 'query'))
      .toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });

  it('accepts the EP-02 body and rejects an extra field', () => {
    const body = {
      code: 'abc',
      code_verifier: 'a'.repeat(64),
      client_id: 'medapp-spa',
      redirect_uri: 'http://localhost:8080/auth/callback',
    };
    expect(tokenRequestSchema.parse(body)).toMatchObject({ code: 'abc' });
    expect(() => tokenRequestSchema.parse({ ...body, grant_type: 'password' })).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });
});

describe('EP-07 / EP-11 request bodies', () => {
  it('accepts a valid booking body', () => {
    const body = { professionalId: 1, slotStart: '2030-01-07T09:00:00.000Z' };
    expect(bookAppointmentSchema.parse(body)).toEqual(body);
  });

  it('rejects a non ISO-8601 slotStart', () => {
    expect(() => bookAppointmentSchema.parse({ professionalId: 1, slotStart: '07/01/2030' }))
      .toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });

  it('rejects an undeclared booking field (a patient cannot choose the patient id)', () => {
    expect(() =>
      bookAppointmentSchema.parse({
        professionalId: 1,
        slotStart: '2030-01-07T09:00:00.000Z',
        patientId: 2,
      }),
    ).toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });

  it('rejects empty clinical text', () => {
    expect(() => encounterSchema.parse({ notes: '   ', diagnosis: 'Flu' })).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('accepts clinical free text as-is', () => {
    const notes = '<script>alert(1)</script> patient reports improvement';
    expect(encounterSchema.parse({ notes, diagnosis: 'Flu' })).toEqual({ notes, diagnosis: 'Flu' });
  });
});

describe('date and array helpers', () => {
  it('rejects an impossible calendar day', () => {
    const schema = string({ format: 'date' });
    expect(() => schema.parse('2030-02-30')).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
    expect(schema.parse('2030-02-28')).toBe('2030-02-28');
  });

  it('rejects an array that is not an array', () => {
    expect(() => arrayOf(string()).parse('nope')).toThrowError(
      expect.objectContaining({ code: 'validation_error' }),
    );
  });

  it('rejects an unknown value of a strict query', () => {
    expect(() => query({ page: optional(integer({ min: 1 })) }).parse({ page: '0' }, 'query'))
      .toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });
});
