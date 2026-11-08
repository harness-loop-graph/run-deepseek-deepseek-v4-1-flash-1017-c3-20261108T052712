import { apiDownload, apiRequest } from './client';
import type {
  AdminUser,
  AgendaDay,
  Appointment,
  AppointmentDetail,
  AuditFilters,
  ClinicalHistory,
  Encounter,
  PaginatedAudit,
  PaginatedUsers,
  ProfessionalSummary,
  RoleName,
  Slot,
} from './types';

/**
 * One function per endpoint of the catalog (RF-11), so a screen never builds
 * a URL or a body by hand. Query parameters are only sent when they carry a
 * value: the backend rejects an empty `from`/`to` with a 422 (RF-12).
 */

/** EP-05: the caller patient's own appointments. */
export function listOwnAppointments(signal?: AbortSignal): Promise<Appointment[]> {
  return apiRequest<Appointment[]>('/me/appointments', { signal });
}

/** EP-06: free slots of a professional in a `YYYY-MM-DD` range. */
export function searchAvailability(
  professionalId: number,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<Slot[]> {
  return apiRequest<Slot[]>('/availability', {
    query: { professionalId, from, to },
    signal,
  });
}

/** EP-07: books one slot; a 409 means the slot was taken meanwhile (RF-13). */
export function bookAppointment(professionalId: number, slotStart: string): Promise<{ id: number }> {
  return apiRequest<{ id: number }>('/appointments', {
    method: 'POST',
    body: { professionalId, slotStart },
  });
}

/** EP-08: cancels one of the caller's own appointments (204). */
export function cancelAppointment(id: number): Promise<void> {
  return apiRequest<void>(`/appointments/${id}`, { method: 'DELETE' });
}

/**
 * EP-09: agenda grouped by day.
 *
 * A professional always reads their own agenda, so `professionalId` is omitted;
 * staff has no professional profile and must name one, otherwise EP-09 answers
 * 422 (`professionalId` required for this caller).
 */
export function fetchAgenda(
  from: string | undefined,
  to: string | undefined,
  signal?: AbortSignal,
  professionalId?: number,
): Promise<AgendaDay[]> {
  return apiRequest<AgendaDay[]>('/agenda', {
    query: { from, to, professionalId },
    signal,
  });
}

/** EP-10: appointment detail (patient own / assigned professional). */
export function fetchAppointment(id: number, signal?: AbortSignal): Promise<AppointmentDetail> {
  return apiRequest<AppointmentDetail>(`/appointments/${id}`, { signal });
}

/** EP-11: records a new encounter version for the appointment (201). */
export function recordEncounter(
  appointmentId: number,
  notes: string,
  diagnosis: string,
): Promise<Encounter> {
  return apiRequest<Encounter>(`/appointments/${appointmentId}/encounter`, {
    method: 'POST',
    body: { notes, diagnosis },
  });
}

/** EP-12: chronology of one patient. */
export function fetchClinicalHistory(
  patientId: number,
  signal?: AbortSignal,
): Promise<ClinicalHistory> {
  return apiRequest<ClinicalHistory>(`/patients/${patientId}/clinical-history`, { signal });
}

/** EP-13: multipart upload of one attachment (PDF/JPEG/PNG, max 5 MB). */
export function uploadAttachment(encounterId: number, file: File): Promise<{
  id: number;
  encounterId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  return apiRequest(`/encounters/${encounterId}/attachments`, {
    method: 'POST',
    formData,
  });
}

/** EP-14: authenticated download of the attachment bytes. */
export function downloadAttachment(attachmentId: number): Promise<Blob> {
  return apiDownload(`/attachments/${attachmentId}`);
}

/** Professional directory used by the SCR-03 `<select>`. */
export function listProfessionals(signal?: AbortSignal): Promise<ProfessionalSummary[]> {
  return apiRequest<ProfessionalSummary[]>('/professionals', { signal });
}

/** EP-15: paginated user list. */
export function listUsers(page: number, signal?: AbortSignal): Promise<PaginatedUsers> {
  return apiRequest<PaginatedUsers>('/admin/users', { query: { page }, signal });
}

/** EP-16: creates a user with the given roles. */
export function createUser(email: string, roles: RoleName[]): Promise<AdminUser> {
  return apiRequest<AdminUser>('/admin/users', { method: 'POST', body: { email, roles } });
}

/** EP-17: replaces the role set of a user. */
export function updateUserRoles(userId: number, roles: RoleName[]): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/users/${userId}/roles`, {
    method: 'PATCH',
    body: { roles },
  });
}

/** EP-18: replaces the whole availability set of a professional. */
export function replaceAvailability(
  professionalId: number,
  slots: Slot[],
): Promise<Slot[]> {
  return apiRequest<Slot[]>(`/admin/professionals/${professionalId}/availability`, {
    method: 'PUT',
    body: { slots },
  });
}

/** EP-19: paginated audit query. */
export function listAudit(filters: AuditFilters, signal?: AbortSignal): Promise<PaginatedAudit> {
  return apiRequest<PaginatedAudit>('/admin/audit', {
    query: {
      actor: filters.actor,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      page: filters.page,
    },
    signal,
  });
}
