/**
 * Date helpers of the SPA.
 *
 * The API speaks two formats (SPEC.md): `YYYY-MM-DD` for request dates and
 * ISO-8601 UTC timestamps for appointments and slots. Formatting for display
 * uses the browser locale, but the wire values are never re-formatted: the
 * exact `start` string returned by EP-06 is what EP-07 receives back.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of a `Date`, in UTC (the API's calendar day). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day, in UTC, as `YYYY-MM-DD`. */
export function todayIso(): string {
  return isoDate(new Date());
}

/** `YYYY-MM-DD` shifted by `days`. */
export function addDaysIso(value: string, days: number): string {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return isoDate(new Date(Date.UTC(year, month - 1, day) + days * DAY_MS));
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Local date + time of an ISO timestamp, e.g. "Mon, 10 Nov 2026 08:30". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "08:30 – 09:00" for one availability slot. */
export function formatSlot(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

/** Human label of a `YYYY-MM-DD` day. */
export function formatDayLabel(value: string): string {
  return formatDate(`${value}T00:00:00.000Z`);
}

/** `HH:MM` of an ISO timestamp, used by the availability editor. */
export function timeOf(iso: string): string {
  return iso.slice(11, 16);
}

/** Builds an ISO-8601 UTC timestamp from a `YYYY-MM-DD` day and an `HH:MM` time. */
export function isoFromDayAndTime(day: string, time: string): string {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return `${day}T${normalized}.000Z`;
}
