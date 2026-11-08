import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  downloadAttachment,
  fetchAgenda,
  fetchClinicalHistory,
  listOwnAppointments,
} from '../api/endpoints';
import { describeError } from '../api/errors';
import type { AttachmentSummary, ClinicalHistory, HistoryEntry, PatientSummary } from '../api/types';
import { session } from '../auth/session';
import { useSession } from '../auth/useSession';
import {
  EmptyState,
  ErrorBanner,
  LoadingIndicator,
  PageHeader,
} from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import { addDaysIso, formatDateTime, todayIso } from '../utils/dates';
import { formatBytes, saveBlob } from '../utils/download';

/**
 * SCR-06 — patient clinical history: chronology with attachments (EP-12, EP-14).
 *
 * The `history-timeline` element contains, as plain text, the notes and the
 * diagnosis of every encounter (RF-22: no HTML is ever injected).
 *
 * - A patient reads only their own history; the patient id is resolved from
 *   the session or, when the session cache is cold, from EP-05.
 * - A professional reads the history of a patient with an assigned
 *   appointment, so the selector is built from their own agenda (EP-09) —
 *   never from a free-text patient id, which the server would reject anyway
 *   (RF-10).
 * - Staff never reaches this screen (RF-20) and would get a 403 from EP-12.
 */
export function ClinicalHistoryScreen(): ReactNode {
  const { identity } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const isProfessional = identity?.roles.includes('professional') === true;

  const ownAppointments = useApiResource(
    (signal) =>
      isProfessional || identity?.patientId !== undefined
        ? Promise.resolve(undefined)
        : listOwnAppointments(signal),
    [isProfessional, identity?.patientId],
  );

  const resolvedOwnPatientId =
    identity?.patientId ?? ownAppointments.data?.[0]?.patientId;

  useEffect(() => {
    if (identity?.patientId === undefined && resolvedOwnPatientId !== undefined) {
      session.patchIdentity({ patientId: resolvedOwnPatientId });
    }
  }, [identity?.patientId, resolvedOwnPatientId]);

  const assigned = useApiResource(
    (signal) =>
      isProfessional
        ? fetchAgenda(addDaysIso(todayIso(), -180), addDaysIso(todayIso(), 180), signal)
        : Promise.resolve([]),
    [isProfessional],
  );

  const assignedPatients = useMemo<PatientSummary[]>(() => {
    const unique = new Map<number, PatientSummary>();
    for (const day of assigned.data ?? []) {
      for (const appointment of day.appointments) {
        if (!unique.has(appointment.patientId)) {
          unique.set(appointment.patientId, appointment.patient);
        }
      }
    }
    return [...unique.values()].sort((a, b) => a.apellidos.localeCompare(b.apellidos));
  }, [assigned.data]);

  const requestedPatientId = Number.parseInt(searchParams.get('patientId') ?? '', 10);
  const selectedPatientId = Number.isFinite(requestedPatientId) && requestedPatientId > 0
    ? requestedPatientId
    : isProfessional
      ? assignedPatients[0]?.id
      : resolvedOwnPatientId;

  useEffect(() => {
    if (!isProfessional || selectedPatientId === undefined) {
      return;
    }
    if (searchParams.get('patientId') === String(selectedPatientId)) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('patientId', String(selectedPatientId));
    setSearchParams(next, { replace: true });
  }, [isProfessional, selectedPatientId, searchParams, setSearchParams]);

  const history = useApiResource<ClinicalHistory>(
    (signal) => {
      if (selectedPatientId === undefined) {
        return Promise.resolve({ patientId: 0, encounters: [] });
      }
      return fetchClinicalHistory(selectedPatientId, signal);
    },
    [selectedPatientId],
  );

  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [downloadingId, setDownloadingId] = useState<number | undefined>(undefined);

  const onDownload = async (attachment: AttachmentSummary): Promise<void> => {
    setActionError(undefined);
    setDownloadingId(attachment.id);
    try {
      const blob = await downloadAttachment(attachment.id);
      saveBlob(blob, attachment.filename);
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setDownloadingId(undefined);
    }
  };

  const loading = history.loading || ownAppointments.loading || assigned.loading;
  const error =
    history.error ?? ownAppointments.error ?? assigned.error;
  const encounters: HistoryEntry[] = history.data?.encounters ?? [];

  const selectPatient = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value === '') {
      next.delete('patientId');
    } else {
      next.set('patientId', value);
    }
    setSearchParams(next, { replace: true });
  };

  return (
    <section className="screen">
      <PageHeader
        title="Clinical history"
        description={
          isProfessional
            ? 'Chronology of the patients with an appointment assigned to you.'
            : 'Your encounters, newest first, with their attachments.'
        }
      />

      {isProfessional ? (
        <div className="filter-bar">
          <label className="field">
            <span>Patient</span>
            <select
              name="patientId"
              value={selectedPatientId === undefined ? '' : String(selectedPatientId)}
              onChange={(event) => selectPatient(event.target.value)}
            >
              <option value="">Select a patient…</option>
              {assignedPatients.map((patient) => (
                <option key={patient.id} value={String(patient.id)}>
                  {patient.apellidos}, {patient.nombre} · {patient.documento}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {actionError === undefined ? null : (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
      )}

      {loading ? <LoadingIndicator label="Loading the clinical history…" /> : null}

      {!loading && error !== undefined ? (
        <ErrorBanner
          message={error}
          onDismiss={() => {
            history.reload();
            ownAppointments.reload();
            assigned.reload();
          }}
        />
      ) : null}

      {!loading && error === undefined && encounters.length === 0 ? (
        <EmptyState
          message={
            isProfessional
              ? 'This patient has no recorded encounters yet.'
              : 'No encounters have been recorded in your clinical history yet.'
          }
        />
      ) : null}

      {encounters.length > 0 ? (
        <ol className="timeline" data-testid="history-timeline">
          {encounters.map((entry) => (
            <li key={entry.id} className="timeline-entry">
              <div className="timeline-meta">
                <strong>{formatDateTime(entry.createdAt)}</strong>
                <span className="muted">
                  {entry.appointment.professional.nombre}{' '}
                  {entry.appointment.professional.apellidos} ·{' '}
                  {entry.appointment.professional.especialidad}
                </span>
                <span className="muted">Version {entry.version}</span>
              </div>
              <p className="clinical-text">{entry.notes}</p>
              <p className="clinical-text">
                <strong>Diagnosis:</strong> {entry.diagnosis}
              </p>
              {entry.attachments.length === 0 ? null : (
                <ul className="attachment-list">
                  {entry.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      <button
                        type="button"
                        className="link-button"
                        disabled={downloadingId === attachment.id}
                        onClick={() => void onDownload(attachment)}
                      >
                        {attachment.filename}
                      </button>{' '}
                      <span className="muted">
                        {formatBytes(attachment.sizeBytes)} ·{' '}
                        {formatDateTime(attachment.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
