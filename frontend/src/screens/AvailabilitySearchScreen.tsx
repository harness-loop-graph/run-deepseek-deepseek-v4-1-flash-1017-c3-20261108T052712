import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  bookAppointment,
  listProfessionals,
  searchAvailability,
} from '../api/endpoints';
import { describeError } from '../api/errors';
import type { ProfessionalSummary, Slot } from '../api/types';
import { useSession } from '../auth/useSession';
import { EmptyState, ErrorBanner, FieldHint, LoadingIndicator, PageHeader } from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import { addDaysIso, formatDayLabel, formatSlot, isValidIsoDate, todayIso } from '../utils/dates';

/**
 * SCR-03 — availability search and booking (EP-06, EP-07).
 *
 * Testability contract: `search-professional` is a `<select>` whose option
 * label contains the professional's surname and whose value is the id,
 * `search-from` / `search-to` are `<input type="date">` with `YYYY-MM-DD`
 * values, `search-submit` runs EP-06, every returned slot is a `slot-item` with
 * `data-slot-start`, and `book-submit` sends EP-07 for the selected slot.
 *
 * A 409 means another patient took the slot in the meantime (RF-13): the
 * search is re-run and the server message is shown verbatim (RF-21). Staff may
 * read the same search but never books — EP-07 is patient-only (RF-09).
 */
export function AvailabilitySearchScreen(): ReactNode {
  const navigate = useNavigate();
  const { identity } = useSession();
  const isPatient = identity?.roles.includes('patient') === true;

  const professionals = useApiResource<ProfessionalSummary[]>(
    (signal) => listProfessionals(signal),
    [],
  );

  const [professionalId, setProfessionalId] = useState<string>('');
  const [from, setFrom] = useState<string>(todayIso());
  const [to, setTo] = useState<string>(addDaysIso(todayIso(), 14));
  const [query, setQuery] = useState<{ professionalId: number; from: string; to: string } | undefined>(
    undefined,
  );
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [selectedStart, setSelectedStart] = useState<string | undefined>(undefined);
  const [booking, setBooking] = useState(false);
  const [searchNonce, setSearchNonce] = useState(0);

  useEffect(() => {
    if (professionalId !== '' || professionals.data === undefined) {
      return;
    }
    const first = professionals.data[0];
    if (first !== undefined) {
      setProfessionalId(String(first.id));
    }
  }, [professionalId, professionals.data]);

  const slots = useApiResource<Slot[]>(
    (signal) => {
      if (query === undefined) {
        return Promise.resolve([]);
      }
      return searchAvailability(query.professionalId, query.from, query.to, signal);
    },
    [query?.professionalId, query?.from, query?.to, searchNonce],
  );

  const onSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    setActionError(undefined);
    setSelectedStart(undefined);

    const id = Number.parseInt(professionalId, 10);
    if (!Number.isFinite(id) || id < 1) {
      setFormError('Select a professional.');
      return;
    }
    if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
      setFormError('Enter both dates as YYYY-MM-DD.');
      return;
    }
    if (from > to) {
      setFormError('The start date must not be after the end date.');
      return;
    }
    setQuery({ professionalId: id, from, to });
    setSearchNonce((value) => value + 1);
  };

  const onBook = async (): Promise<void> => {
    if (query === undefined || selectedStart === undefined) {
      setFormError('Select an available slot first.');
      return;
    }
    setFormError(undefined);
    setActionError(undefined);
    setBooking(true);
    try {
      await bookAppointment(query.professionalId, selectedStart);
      navigate('/appointments');
    } catch (cause) {
      setActionError(describeError(cause));
      setSelectedStart(undefined);
      setSearchNonce((value) => value + 1);
    } finally {
      setBooking(false);
    }
  };

  const hasSlots = slots.data !== undefined && slots.data.length > 0;

  return (
    <section className="screen">
      <PageHeader
        title="Availability search"
        description={
          isPatient
            ? 'Find a free slot and book it in one step.'
            : 'Read-only view of the professionals’ free slots.'
        }
      />

      {professionals.error === undefined ? null : (
        <ErrorBanner message={professionals.error} onDismiss={professionals.reload} />
      )}

      {professionals.loading ? (
        <LoadingIndicator label="Loading the professional directory…" />
      ) : (
        <form className="filter-bar" onSubmit={onSearch} noValidate>
          <label className="field">
            <span>Professional</span>
            <select
              data-testid="search-professional"
              name="professionalId"
              value={professionalId}
              onChange={(event) => setProfessionalId(event.target.value)}
            >
              <option value="">Select a professional…</option>
              {(professionals.data ?? []).map((professional) => (
                <option key={professional.id} value={String(professional.id)}>
                  {professional.apellidos}, {professional.nombre} — {professional.especialidad}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>From</span>
            <input
              type="date"
              data-testid="search-from"
              name="from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>

          <label className="field">
            <span>To</span>
            <input
              type="date"
              data-testid="search-to"
              name="to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>

          <button type="submit" data-testid="search-submit" className="primary">
            Search availability
          </button>
        </form>
      )}

      {formError === undefined ? null : <ErrorBanner message={formError} />}
      {actionError === undefined ? null : (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
      )}

      {query === undefined ? (
        <EmptyState message="Choose a professional and a date range to see the free slots." />
      ) : (
        <>
          {slots.loading ? <LoadingIndicator label="Searching free slots…" /> : null}

          {slots.error === undefined ? null : (
            <ErrorBanner message={slots.error} onDismiss={slots.reload} />
          )}

          {!slots.loading && slots.error === undefined && !hasSlots ? (
            <EmptyState message="No free slots for that professional in the selected range." />
          ) : null}

          {hasSlots ? (
            <>
              <h2 className="section-title">Free slots</h2>
              <div className="slot-grid">
                {slots.data?.map((slot) => {
                  const selected = slot.start === selectedStart;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      data-testid="slot-item"
                      data-slot-start={slot.start}
                      aria-pressed={selected}
                      className={selected ? 'slot-item slot-item-selected' : 'slot-item'}
                      onClick={() => {
                        setSelectedStart(slot.start);
                        setFormError(undefined);
                      }}
                    >
                      <span className="slot-day">{formatDayLabel(slot.start.slice(0, 10))}</span>
                      <span className="slot-time">{formatSlot(slot.start, slot.end)}</span>
                    </button>
                  );
                })}
              </div>

              {isPatient ? (
                <div className="book-bar">
                  <p className="muted">
                    {selectedStart === undefined
                      ? 'Select one of the slots above.'
                      : `Selected: ${formatDayLabel(selectedStart.slice(0, 10))} · ${formatSlot(
                          selectedStart,
                          slots.data?.find((slot) => slot.start === selectedStart)?.end ??
                            selectedStart,
                        )}`}
                  </p>
                  <button
                    type="button"
                    className="primary"
                    data-testid="book-submit"
                    disabled={selectedStart === undefined || booking}
                    onClick={() => void onBook()}
                  >
                    {booking ? 'Booking…' : 'Book selected slot'}
                  </button>
                  <FieldHint>
                    A slot taken by another patient answers 409 and is removed from the list.
                  </FieldHint>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
