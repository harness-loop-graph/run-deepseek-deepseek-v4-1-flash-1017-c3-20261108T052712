import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  downloadAttachment,
  fetchAppointment,
  recordEncounter,
  uploadAttachment,
} from '../api/endpoints';
import { describeError } from '../api/errors';
import type { AppointmentDetail, AttachmentSummary } from '../api/types';
import { STATUS_LABELS } from '../api/types';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES } from '../config';
import { useSession } from '../auth/useSession';
import {
  EmptyState,
  ErrorBanner,
  FieldHint,
  LoadingIndicator,
  PageHeader,
} from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import { formatDateTime } from '../utils/dates';
import { formatBytes, saveBlob } from '../utils/download';

/**
 * SCR-05 — appointment detail and encounter recording (EP-10, EP-11, EP-13).
 *
 * A professional sees the encounter form (`encounter-notes`,
 * `encounter-diagnosis`, `encounter-submit`) plus the attachment uploader; a
 * patient sees the same appointment read-only, because EP-11/EP-13 are
 * professional-only on the server (RF-09). Notes and diagnosis are rendered as
 * text nodes, never as HTML (RF-22).
 */
export function AppointmentDetailScreen(): ReactNode {
  const params = useParams();
  const navigate = useNavigate();
  const { identity } = useSession();
  const appointmentId = Number.parseInt(params.id ?? '', 10);
  const valid = Number.isFinite(appointmentId) && appointmentId > 0;

  const appointment = useApiResource<AppointmentDetail>(
    (signal) =>
      valid
        ? fetchAppointment(appointmentId, signal)
        : Promise.reject(new Error('The appointment id is not valid.')),
    [appointmentId, valid],
  );

  const [notes, setNotes] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | undefined>(undefined);

  const detail = appointment.data;
  const isProfessional = identity?.roles.includes('professional') === true;
  const canRecord =
    isProfessional && detail !== undefined && detail.status !== 'cancelled';

  const onSubmitEncounter = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(undefined);
    setActionError(undefined);

    if (notes.trim().length === 0) {
      setFormError('Write the clinical notes before submitting.');
      return;
    }
    if (diagnosis.trim().length === 0) {
      setFormError('Write the diagnosis before submitting.');
      return;
    }

    setSaving(true);
    try {
      await recordEncounter(appointmentId, notes, diagnosis);
      setNotes('');
      setDiagnosis('');
      appointment.reload();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setActionError(undefined);
    const latest = detail?.encounters[detail.encounters.length - 1];
    if (latest === undefined) {
      setActionError('Record an encounter before attaching a file.');
      return;
    }
    if (file === undefined) {
      setActionError('Choose a PDF, JPEG or PNG file first.');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setActionError('The file is larger than 5 MB.');
      return;
    }

    setUploading(true);
    try {
      await uploadAttachment(latest.id, file);
      setFile(undefined);
      appointment.reload();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setUploading(false);
    }
  };

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

  return (
    <section className="screen">
      <PageHeader title="Appointment detail" description="Clinical record of one appointment.">
        <button type="button" className="secondary" onClick={() => navigate(-1)}>
          Back
        </button>
      </PageHeader>

      {appointment.loading ? <LoadingIndicator label="Loading the appointment…" /> : null}

      {appointment.error === undefined ? null : (
        <ErrorBanner message={appointment.error} onDismiss={appointment.reload} />
      )}

      {actionError === undefined ? null : (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
      )}

      {detail === undefined ? null : (
        <>
          <dl className="detail-grid">
            <div>
              <dt>When</dt>
              <dd>{formatDateTime(detail.start)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className={`status status-${detail.status}`}>
                  {STATUS_LABELS[detail.status]}
                </span>
              </dd>
            </div>
            <div>
              <dt>Patient</dt>
              <dd>
                {detail.patient.nombre} {detail.patient.apellidos} · {detail.patient.documento}
              </dd>
            </div>
            <div>
              <dt>Professional</dt>
              <dd>
                {detail.professional.nombre} {detail.professional.apellidos} ·{' '}
                {detail.professional.especialidad}
              </dd>
            </div>
          </dl>

          <h2 className="section-title">Encounters</h2>
          {detail.encounters.length === 0 ? (
            <EmptyState message="No encounter has been recorded for this appointment yet." />
          ) : (
            <div className="list">
              {detail.encounters.map((encounter) => (
                <article key={encounter.id} className="encounter-card">
                  <header>
                    <strong>Version {encounter.version}</strong>
                    <span className="muted">{formatDateTime(encounter.createdAt)}</span>
                  </header>
                  <p className="clinical-text">{encounter.notes}</p>
                  <p className="clinical-text">
                    <strong>Diagnosis:</strong> {encounter.diagnosis}
                  </p>
                  {encounter.attachments.length === 0 ? null : (
                    <ul className="attachment-list">
                      {encounter.attachments.map((attachment) => (
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
                </article>
              ))}
            </div>
          )}

          {canRecord ? (
            <form className="stack card" onSubmit={(event) => void onSubmitEncounter(event)} noValidate>
              <h2 className="section-title">Record an encounter</h2>
              <label htmlFor="encounter-notes">Notes</label>
              <textarea
                id="encounter-notes"
                data-testid="encounter-notes"
                name="notes"
                rows={5}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />

              <label htmlFor="encounter-diagnosis">Diagnosis</label>
              <textarea
                id="encounter-diagnosis"
                data-testid="encounter-diagnosis"
                name="diagnosis"
                rows={3}
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
              />

              {formError === undefined ? null : <ErrorBanner message={formError} />}

              <button type="submit" className="primary" data-testid="encounter-submit" disabled={saving}>
                {saving ? 'Saving…' : 'Save encounter'}
              </button>
              <FieldHint>
                Every correction is stored as a new version; nothing is ever overwritten.
              </FieldHint>
            </form>
          ) : null}

          {canRecord ? (
            <form className="stack card" onSubmit={(event) => void onUpload(event)}>
              <h2 className="section-title">Attach a file</h2>
              <input
                type="file"
                name="file"
                accept={ATTACHMENT_ACCEPT}
                onChange={(event) => setFile(event.target.files?.[0])}
              />
              <FieldHint>PDF, JPEG or PNG, at most 5 MB.</FieldHint>
              <button type="submit" disabled={uploading || detail.encounters.length === 0}>
                {uploading ? 'Uploading…' : 'Upload attachment'}
              </button>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
