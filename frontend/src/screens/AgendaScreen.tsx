import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchAgenda, listProfessionals } from '../api/endpoints';
import type { AgendaDay, ProfessionalSummary } from '../api/types';
import { useSession } from '../auth/useSession';
import { AppointmentItem } from '../components/AppointmentItem';
import { EmptyState, ErrorBanner, LoadingIndicator, PageHeader } from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import { addDaysIso, formatDayLabel, isValidIsoDate, todayIso } from '../utils/dates';

/**
 * SCR-04 — professional agenda, day and week views (EP-09).
 *
 * First render is the fixed window of the contract: from today through the
 * next 7 days (the backend's own default, sent explicitly so the client and
 * the server never disagree). Every appointment is an `appointment-item` with
 * `data-appointment-id`; clicking it opens SCR-05 (EP-10).
 *
 * A professional always reads their own agenda (the server ignores any other
 * id); staff must name the professional, so the screen offers the directory
 * selector in that case. Staff never gets the clinical link of SCR-05.
 */
export function AgendaScreen(): ReactNode {
  const navigate = useNavigate();
  const { identity } = useSession();
  const isProfessional = identity?.roles.includes('professional') === true;
  const isStaff = identity?.roles.includes('staff') === true && !isProfessional;

  const professionals = useApiResource<ProfessionalSummary[]>(
    (signal) => (isStaff ? listProfessionals(signal) : Promise.resolve([])),
    [isStaff],
  );

  const [staffProfessionalId, setStaffProfessionalId] = useState<string>('');
  const [from, setFrom] = useState<string>(todayIso());
  const [to, setTo] = useState<string>(addDaysIso(todayIso(), 7));
  const [view, setView] = useState<'week' | 'day'>('week');
  const [applied, setApplied] = useState<{ from: string; to: string } | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isStaff || staffProfessionalId !== '' || professionals.data === undefined) {
      return;
    }
    const first = professionals.data[0];
    if (first !== undefined) {
      setStaffProfessionalId(String(first.id));
    }
  }, [isStaff, staffProfessionalId, professionals.data]);

  const staffId = Number.parseInt(staffProfessionalId, 10);
  const queryProfessionalId =
    isStaff && Number.isFinite(staffId) && staffId > 0 ? staffId : undefined;

  const agenda = useApiResource<AgendaDay[]>(
    (signal) => {
      if (isStaff && queryProfessionalId === undefined) {
        return Promise.resolve([]);
      }
      return fetchAgenda(
        applied?.from ?? todayIso(),
        applied?.to ?? addDaysIso(todayIso(), 7),
        signal,
        queryProfessionalId,
      );
    },
    [applied?.from, applied?.to, queryProfessionalId, isStaff],
  );

  const onApply = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      setFormError('Enter both dates as YYYY-MM-DD.');
      return;
    }
    if (from > to) {
      setFormError('The start date must not be after the end date.');
      return;
    }
    setApplied({ from, to });
  };

  const days = agenda.data ?? [];
  const visibleDays = view === 'day' ? days.slice(0, 1) : days;
  const totalAppointments = days.reduce((sum, day) => sum + day.appointments.length, 0);

  return (
    <section className="screen">
      <PageHeader
        title="Agenda"
        description={
          isProfessional
            ? 'Your appointments, from today through the next 7 days.'
            : 'Scheduling view of one professional’s appointments.'
        }
      >
        <div className="segmented" role="group" aria-label="Agenda view">
          <button
            type="button"
            className={view === 'week' ? 'segmented-active' : ''}
            aria-pressed={view === 'week'}
            onClick={() => setView('week')}
          >
            Week
          </button>
          <button
            type="button"
            className={view === 'day' ? 'segmented-active' : ''}
            aria-pressed={view === 'day'}
            onClick={() => setView('day')}
          >
            Day
          </button>
        </div>
      </PageHeader>

      {professionals.error === undefined ? null : (
        <ErrorBanner message={professionals.error} onDismiss={professionals.reload} />
      )}

      <form className="filter-bar" onSubmit={onApply} noValidate>
        {isStaff ? (
          <label className="field">
            <span>Professional</span>
            <select
              name="professionalId"
              value={staffProfessionalId}
              onChange={(event) => setStaffProfessionalId(event.target.value)}
            >
              <option value="">Select a professional…</option>
              {(professionals.data ?? []).map((professional) => (
                <option key={professional.id} value={String(professional.id)}>
                  {professional.apellidos}, {professional.nombre} — {professional.especialidad}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="field">
          <span>From</span>
          <input type="date" name="from" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>

        <label className="field">
          <span>To</span>
          <input type="date" name="to" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>

        <button type="submit" className="primary">
          Apply
        </button>
      </form>

      {formError === undefined ? null : <ErrorBanner message={formError} />}

      {agenda.loading ? <LoadingIndicator label="Loading the agenda…" /> : null}

      {agenda.error === undefined ? null : (
        <ErrorBanner message={agenda.error} onDismiss={agenda.reload} />
      )}

      {!agenda.loading && agenda.error === undefined && totalAppointments === 0 ? (
        <EmptyState message="No appointments in this window." />
      ) : null}

      {visibleDays.map((day) => (
        <section key={day.date} className="agenda-day">
          <h2 className="section-title">{formatDayLabel(day.date)}</h2>
          <div className="list">
            {day.appointments.map((appointment) => (
              <AppointmentItem
                key={appointment.id}
                appointment={appointment}
                showPatient
                onOpen={
                  isStaff ? undefined : () => navigate(`/appointments/${appointment.id}`)
                }
              />
            ))}
          </div>
        </section>
      ))}

      {view === 'day' && visibleDays.length > 0 ? (
        <p className="muted">
          Showing the first day of the window. Switch to “Week” for the whole range.
        </p>
      ) : null}
    </section>
  );
}
