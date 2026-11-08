import { validationError } from './errors';

/**
 * Boundary validation (RF-12).
 *
 * Every endpoint declares a schema and parses its input through it. The
 * object schema is strict: a field that is not declared is rejected with 422
 * instead of being silently ignored. No third-party validation library is
 * needed, which keeps the runtime dependencies of the image small and the
 * error messages under our control (RF-16).
 */

export interface Schema<T> {
  parse(value: unknown, path?: string): T;
}

function fail(path: string, message: string): never {
  throw validationError(`${path}: ${message}`);
}

function schema<T>(parse: (value: unknown, path: string) => T): Schema<T> {
  return {
    parse(value: unknown, path = 'body'): T {
      return parse(value, path);
    },
  };
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  trim?: boolean;
  pattern?: RegExp;
  patternMessage?: string;
  format?: 'date' | 'date-time' | 'email' | 'uuid';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `YYYY-MM-DD` of a real calendar day. */
export function isValidCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function string(options: StringOptions = {}): Schema<string> {
  return schema<string>((value, path) => {
    if (typeof value !== 'string') {
      fail(path, 'must be a string');
    }
    const text = options.trim === false ? value : value.trim();
    if (options.minLength !== undefined && text.length < options.minLength) {
      fail(path, `must have at least ${options.minLength} characters`);
    }
    if (options.maxLength !== undefined && text.length > options.maxLength) {
      fail(path, `must have at most ${options.maxLength} characters`);
    }
    if (options.format === 'date' && !isValidCalendarDate(text)) {
      fail(path, 'must be a valid date in YYYY-MM-DD format');
    }
    if (options.format === 'date-time' && (!ISO_DATE_TIME.test(text) || Number.isNaN(Date.parse(text)))) {
      fail(path, 'must be a valid ISO-8601 timestamp');
    }
    if (options.format === 'email' && (!EMAIL.test(text) || text.length > 254)) {
      fail(path, 'must be a valid email address');
    }
    if (options.format === 'uuid' && !/^[0-9a-fA-F-]{36}$/.test(text)) {
      fail(path, 'must be a valid uuid');
    }
    if (options.pattern !== undefined && !options.pattern.test(text)) {
      fail(path, options.patternMessage ?? 'has an invalid format');
    }
    return text;
  });
}

export interface IntegerOptions {
  min?: number;
  max?: number;
}

export function integer(options: IntegerOptions = {}): Schema<number> {
  return schema<number>((value, path) => {
    let parsed: number;
    if (typeof value === 'number') {
      parsed = value;
    } else if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
      parsed = Number.parseInt(value.trim(), 10);
    } else {
      fail(path, 'must be an integer');
    }
    if (!Number.isInteger(parsed)) {
      fail(path, 'must be an integer');
    }
    if (options.min !== undefined && parsed < options.min) {
      fail(path, `must be >= ${options.min}`);
    }
    if (options.max !== undefined && parsed > options.max) {
      fail(path, `must be <= ${options.max}`);
    }
    return parsed;
  });
}

export function boolean(): Schema<boolean> {
  return schema<boolean>((value, path) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true' || value === 'false') {
      return value === 'true';
    }
    return fail(path, 'must be a boolean');
  });
}

export function oneOf<T extends string>(values: readonly T[]): Schema<T> {
  return schema<T>((value, path) => {
    if (typeof value !== 'string' || !values.includes(value as T)) {
      return fail(path, `must be one of: ${values.join(', ')}`);
    }
    return value as T;
  });
}

export function optional<T>(inner: Schema<T>): Schema<T | undefined> {
  return schema<T | undefined>((value, path) => {
    if (value === undefined) {
      return undefined;
    }
    return inner.parse(value, path);
  });
}

export interface ArrayOptions {
  minLength?: number;
  maxLength?: number;
}

export function arrayOf<T>(inner: Schema<T>, options: ArrayOptions = {}): Schema<T[]> {
  return schema<T[]>((value, path) => {
    if (!Array.isArray(value)) {
      fail(path, 'must be an array');
    }
    if (options.minLength !== undefined && value.length < options.minLength) {
      fail(path, `must contain at least ${options.minLength} items`);
    }
    if (options.maxLength !== undefined && value.length > options.maxLength) {
      fail(path, `must contain at most ${options.maxLength} items`);
    }
    return value.map((item, index) => inner.parse(item, `${path}[${index}]`));
  });
}

export type Shape = Record<string, Schema<unknown>>;

/**
 * Strict object schema: declared keys are validated, unknown keys are a 422.
 */
export function object<T>(shape: Shape): Schema<T> {
  const keys = Object.keys(shape);
  return schema<T>((value, path) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      fail(path, 'must be an object');
    }
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!keys.includes(key)) {
        fail(path, `unknown field "${key}"`);
      }
    }

    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const fieldSchema = shape[key];
      const raw = input[key];
      if (raw === undefined) {
        // An omitted optional field stays absent; a required field fails.
        const parsed = fieldSchema.parse(undefined, `${path}.${key}`);
        if (parsed !== undefined) {
          output[key] = parsed;
        }
        continue;
      }
      output[key] = fieldSchema.parse(raw, `${path}.${key}`);
    }
    return output as T;
  });
}

/** Parses a query string object (all values are strings or arrays of strings). */
export function query<T>(shape: Shape): Schema<T> {
  const keys = Object.keys(shape);
  return schema<T>((value, path) => {
    if (value === undefined || value === null) {
      return object<T>(shape).parse({}, path);
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
      fail(path, 'must be an object');
    }
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (!keys.includes(key)) {
        fail(path, `unknown query parameter "${key}"`);
      }
      if (Array.isArray(input[key])) {
        fail(path, `query parameter "${key}" must be given once`);
      }
    }

    const output: Record<string, unknown> = {};
    for (const key of keys) {
      const fieldSchema = shape[key];
      const raw = input[key];
      if (raw === undefined) {
        const parsed = fieldSchema.parse(undefined, `${path}.${key}`);
        if (parsed !== undefined) {
          output[key] = parsed;
        }
        continue;
      }
      output[key] = fieldSchema.parse(raw, `${path}.${key}`);
    }
    return output as T;
  });
}

export function required<T>(inner: Schema<T>): Schema<T> {
  return schema<T>((value, path) => {
    if (value === undefined || value === null) {
      return fail(path, 'is required');
    }
    return inner.parse(value, path);
  });
}

/** A required string that may not be empty (used for notes, diagnosis, ...). */
export function nonEmptyString(maxLength: number): Schema<string> {
  return schema<string>((value, path) => {
    if (typeof value !== 'string') {
      fail(path, 'must be a string');
    }
    if (value.trim() === '') {
      fail(path, 'must not be empty');
    }
    if (value.length > maxLength) {
      fail(path, `must have at most ${maxLength} characters`);
    }
    return value;
  });
}
