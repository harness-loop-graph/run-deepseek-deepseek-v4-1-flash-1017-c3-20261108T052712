/**
 * Date helpers shared by the scheduling endpoints.
 *
 * SPEC.md fixes the wire formats: request dates are `YYYY-MM-DD` and
 * timestamps are ISO-8601 UTC strings. Internally everything is a `Date`
 * (UTC); the helpers below convert without ever depending on the process
 * timezone.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` -> UTC midnight of that calendar day. */
export function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/** UTC midnight of the calendar day containing `date`. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

/** Last millisecond of the calendar day containing `date`. */
export function endOfUtcDay(date: Date): Date {
  return new Date(startOfUtcDay(date).getTime() + DAY_MS - 1);
}

/** `YYYY-MM-DD` of a timestamp, in UTC. */
export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function toIso(value: Date): string {
  return value.toISOString();
}

/**
 * Resolves the `from`/`to` range of a query.
 *
 * - Both absent: today .. today + 7 days (the SCR-04 default window).
 * - `to` before `from`: invalid range (the caller maps it to 422).
 */
export function resolveRange(
  from: string | undefined,
  to: string | undefined,
  defaultDays = 7,
): { start: Date; end: Date } {
  const today = startOfUtcDay(new Date());
  const start = from === undefined ? today : parseDateOnly(from);
  const end = to === undefined ? endOfUtcDay(addDays(start, defaultDays)) : endOfUtcDay(parseDateOnly(to));
  return { start, end };
}

export function isValidRange(start: Date, end: Date): boolean {
  return start.getTime() <= end.getTime();
}

/** True when two half-open intervals overlap. */
export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
