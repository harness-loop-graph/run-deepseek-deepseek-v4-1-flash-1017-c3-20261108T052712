/**
 * Deterministic seed data (RF-05).
 *
 * Everything in this file is a constant: the same users, roles, patients,
 * professionals and availability window are produced in every run, and the
 * insertion order fixes the identity ids (`paciente1..3` → 1..3, `gomez` → 1,
 * `lopez` → 2).
 */

export const SEED_PASSWORD_DEFAULT = 'Seed!Passw0rd';

export type RoleName = 'patient' | 'professional' | 'staff' | 'admin';

/** Insertion order is part of the contract: it fixes `rol.id`. */
export const SEED_ROLES: readonly RoleName[] = ['patient', 'professional', 'staff', 'admin'];

export interface SeedUser {
  email: string;
  roles: readonly RoleName[];
}

/**
 * Insertion order is part of the contract: it fixes `usuario.id`, and
 * therefore the patient/professional ids of the profile rows inserted below.
 */
export const SEED_USERS: readonly SeedUser[] = [
  { email: 'admin@seed.local', roles: ['admin'] },
  { email: 'staff@seed.local', roles: ['staff'] },
  { email: 'paciente1@seed.local', roles: ['patient'] },
  { email: 'paciente2@seed.local', roles: ['patient'] },
  { email: 'paciente3@seed.local', roles: ['patient'] },
  { email: 'gomez@seed.local', roles: ['professional'] },
  { email: 'lopez@seed.local', roles: ['professional'] },
];

export interface SeedPatient {
  email: string;
  nombre: string;
  apellidos: string;
  documento: string;
  fechaNacimiento: string;
}

export const SEED_PATIENTS: readonly SeedPatient[] = [
  {
    email: 'paciente1@seed.local',
    nombre: 'Ana',
    apellidos: 'Pérez',
    documento: 'DOC-0001',
    fechaNacimiento: '1990-01-15',
  },
  {
    email: 'paciente2@seed.local',
    nombre: 'Luis',
    apellidos: 'Ramírez',
    documento: 'DOC-0002',
    fechaNacimiento: '1985-06-02',
  },
  {
    email: 'paciente3@seed.local',
    nombre: 'Marta',
    apellidos: 'Soler',
    documento: 'DOC-0003',
    fechaNacimiento: '2000-11-23',
  },
];

export interface SeedProfessional {
  email: string;
  nombre: string;
  /** The surname appears in the SCR-03 `<select>` option label. */
  apellidos: string;
  especialidad: string;
  /** `lopez` has no slots on Fridays (RF-05). */
  worksFridays: boolean;
}

export const SEED_PROFESSIONALS: readonly SeedProfessional[] = [
  {
    email: 'gomez@seed.local',
    nombre: 'Elena',
    apellidos: 'Gómez',
    especialidad: 'Medicina General',
    worksFridays: true,
  },
  {
    email: 'lopez@seed.local',
    nombre: 'Javier',
    apellidos: 'López',
    especialidad: 'Cardiología',
    worksFridays: false,
  },
];

/** Availability window: weekdays 08:00–16:00, 30-minute slots, 14 days. */
export const SEED_AVAILABILITY = {
  /** First day of the window, expressed as an offset from "today" (UTC). */
  startDayOffset: 0,
  /** Number of consecutive calendar days covered, starting at the offset. */
  days: 14,
  /** Slot start, in minutes from midnight UTC. */
  firstSlotMinute: 8 * 60,
  /** Exclusive end of the daily window, in minutes from midnight UTC. */
  lastSlotMinute: 16 * 60,
  /** Slot length in minutes. */
  slotMinutes: 30,
  /** Friday, in `Date#getUTCDay()` numbering. */
  friday: 5,
} as const;
