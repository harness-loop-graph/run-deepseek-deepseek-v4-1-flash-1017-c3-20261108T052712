import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cancelAppointment, listOwnAppointments } from '../api/endpoints';
import { describeError } from '../api/errors';
import type { Appointment } from '../api/types';
import { session } from '../auth/session';
import { useSession } from '../auth/useSession';
import { AppointmentItem } from '../components/AppointmentItem';
import { EmptyState, ErrorBanner, LoadingIndicator, PageHeader } from '../components/States';
import { useApiResource } from '../hooks/useApiResource';

/**
 * SCR-02 — patient portal: the caller's own appointments (EP-05, EP-08).
 *
 * The list is the only source of the `appointment-item` /
 * `cancel-appointment` test ids of the contract. A cancelled appointment stays
 * in the list (RF-06 keeps history) but loses its cancel action.
 *
 * The patient profile id discovered here is cached in the session so SCR-06
 * (own clinical history) does not need a second round trip.
 */
export function PatientAppointmentsScreen(): ReactNode {
  const navigate = useNavigate();
  const { identity } = useSession();
  const appointments = useApiResource<Appointment[]>(
    (signal) => listOwnAppointments(signal),
    [],
  );
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [cancellingId, setCancellingId] = useState<number | undefined>(undefined);

  const patientId = identity?.patientId;
  const discoveredPatientId = appointments.data?.[0]?.patientId;

  // The access token is opaque, so the profile id is discovered from the data
  // the screen already loaded and cached for SCR-06 (never assumed by the UI).
  useEffect(() => {
    if (patientId === undefined && discoveredPatientId !== undefined) {
      session.patchIdentity({ patientId: discoveredPatientId });
    }
  }, [patientId, discoveredPatientId]);

  const onCancel = async (appointment: Appointment): Promise<void> => {
    setActionError(undefined);
    setCancellingId(appointment.id);
    try {
      await cancelAppointment(appointment.id);
      appointments.reload();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setCancellingId(undefined);
    }
  };

  return (
    <section className="screen">
      <PageHeader
        title="My appointments"
        description="Every appointment booked under your patient record."
      >
        <button type="button" onClick={() => navigate('/search')}>
          Book an appointment
        </button>
      </PageHeader>

      {actionError === undefined ? null : (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
      )}

      {appointments.loading ? <LoadingIndicator label="Loading your appointments…" /> : null}

      {appointments.error === undefined ? null : (
        <ErrorBanner message={appointments.error} onDismiss={appointments.reload} />
      )}

      {!appointments.loading &&
      appointments.error === undefined &&
      appointments.data !== undefined &&
      appointments.data.length === 0 ? (
        <EmptyState message="You have no appointments yet. Use “Book an appointment” to schedule one." />
      ) : null}

      {appointments.data !== undefined && appointments.data.length > 0 ? (
        <div className="list">
          {appointments.data.map((appointment) => (
            <AppointmentItem
              key={appointment.id}
              appointment={appointment}
              showPatient={false}
              showProfessional
              onOpen={() => navigate(`/appointments/${appointment.id}`)}
            >
              {appointment.status === 'cancelled' ? null : (
                <button
                  type="button"
                  className="secondary"
                  data-testid="cancel-appointment"
                  disabled={cancellingId === appointment.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onCancel(appointment);
                  }}
                >
                  {cancellingId === appointment.id ? 'Cancelling…' : 'Cancel'}
                </button>
              )}
            </AppointmentItem>
          ))}
        </div>
      ) : null}
    </section>
  );
}
