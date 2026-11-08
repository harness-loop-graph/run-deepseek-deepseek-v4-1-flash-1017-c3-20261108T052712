/**
 * Wire types of the REST API (EP-05 .. EP-19), exactly as the backend
 * serialises them (see `docs/architecture.md` §2 and §3).
 */

export type RoleName = 'patient' | 'professional' | 'staff' | 'admin';

export const ROLE_NAMES: readonly RoleName[] = ['patient', 'professional', 'staff', 'admin'];

export type AppointmentStatus = 'scheduled' | 'attended' | 'cancelled' | 'no_show';

export interface PatientSummary {
  id: number;
  nombre: string;
  apellidos: string;
  documento: string;
}

export interface ProfessionalSummary {
  id: number;
  nombre: string;
  apellidos: string;
  especialidad: string;
}

export interface AttachmentSummary {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Encounter {
  id: number;
  appointmentId: number;
  version: number;
  notes: string;
  diagnosis: string;
  authorProfessionalId: number;
  replacesId: number | null;
  createdAt: string;
  attachments: AttachmentSummary[];
}

export interface Appointment {
  id: number;
  patientId: number;
  professionalId: number;
  /** ISO-8601 UTC timestamp. */
  start: string;
  end: string;
  status: AppointmentStatus;
  createdAt: string;
  patient: PatientSummary;
  professional: ProfessionalSummary;
}

export interface AppointmentDetail extends Appointment {
  encounters: Encounter[];
}

export interface HistoryEntry extends Encounter {
  appointment: {
    id: number;
    start: string;
    status: AppointmentStatus;
    professional: ProfessionalSummary;
  };
}

export interface ClinicalHistory {
  patientId: number;
  encounters: HistoryEntry[];
}

export interface AgendaDay {
  /** `YYYY-MM-DD` (UTC). */
  date: string;
  appointments: Appointment[];
}

export interface Slot {
  start: string;
  end: string;
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
}

export interface AdminUser {
  id: number;
  email: string;
  active: boolean;
  roles: RoleName[];
  patientId: number | null;
  professionalId: number | null;
  createdAt: string;
}

export interface PaginatedUsers {
  items: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditRecord {
  id: number;
  actor: { id: number; email: string };
  action: string;
  resourceType: string;
  resourceId: number | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface PaginatedAudit {
  items: AuditRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BookAppointmentRequest {
  professionalId: number;
  slotStart: string;
}

export interface EncounterRequest {
  notes: string;
  diagnosis: string;
}

export interface AuditFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  attended: 'Attended',
  cancelled: 'Cancelled',
  no_show: 'No show',
};
