/**
 * Identity of the caller, resolved from the access token on every request
 * (RF-09: authorization is verified server-side, never trusted from the UI).
 */
export const ROLE_NAMES = ['patient', 'professional', 'staff', 'admin'] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export function isRoleName(value: unknown): value is RoleName {
  return typeof value === 'string' && (ROLE_NAMES as readonly string[]).includes(value);
}

export interface AuthUser {
  userId: number;
  email: string;
  roles: RoleName[];
  /** Profile id of the caller when they hold the `patient` role. */
  patientId?: number;
  /** Profile id of the caller when they hold the `professional` role. */
  professionalId?: number;
}

export function hasRole(user: AuthUser, role: RoleName): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(user: AuthUser, roles: readonly RoleName[]): boolean {
  return roles.some((role) => user.roles.includes(role));
}

/**
 * Access decision for the clinical history of a patient (RF-10):
 *
 * - a patient reads only their own history;
 * - a professional reads it only when an appointment is assigned to them;
 * - staff and admin never read clinical content.
 *
 * The caller passes the patient id and whether the professional has an
 * appointment with that patient; the same rule is enforced in SQL by the
 * query, so a misconfigured route still cannot leak data.
 */
export function canReadClinicalHistory(
  user: AuthUser,
  patientId: number,
  professionalHasAppointment: boolean,
): boolean {
  if (hasRole(user, 'patient') && user.patientId === patientId) {
    return true;
  }
  if (hasRole(user, 'professional') && professionalHasAppointment) {
    return true;
  }
  return false;
}

/** A patient only ever reads appointments of their own profile. */
export function canReadAppointmentAsPatient(user: AuthUser, patientId: number): boolean {
  return hasRole(user, 'patient') && user.patientId === patientId;
}

/** A professional only ever reads appointments assigned to them. */
export function canReadAppointmentAsProfessional(user: AuthUser, professionalId: number): boolean {
  return hasRole(user, 'professional') && user.professionalId === professionalId;
}
