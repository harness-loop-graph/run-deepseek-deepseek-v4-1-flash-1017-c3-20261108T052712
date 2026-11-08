import { useEffect, useState, type ReactNode } from 'react';
import {
  createUser,
  listProfessionals,
  listUsers,
  replaceAvailability,
  updateUserRoles,
} from '../api/endpoints';
import { describeError } from '../api/errors';
import type {
  AdminUser,
  PaginatedUsers,
  ProfessionalSummary,
  RoleName,
  Slot,
} from '../api/types';
import { ROLE_NAMES } from '../api/types';
import {
  EmptyState,
  ErrorBanner,
  FieldHint,
  LoadingIndicator,
  PageHeader,
} from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import {
  addDaysIso,
  formatDayLabel,
  formatSlot,
  isValidIsoDate,
  isoFromDayAndTime,
  todayIso,
} from '../utils/dates';

/**
 * SCR-07 — administration: availability, users, roles (EP-15 .. EP-18).
 *
 * Three independent panels, each with its own loading / error / empty state
 * (RF-24) and its own server-envelope display (RF-21). Client-side validation
 * only guards obvious mistakes; the server stays the authority (422/409).
 */

const ROLE_LABELS: Record<RoleName, string> = {
  patient: 'Patient',
  professional: 'Professional',
  staff: 'Administrative staff',
  admin: 'Administrator',
};

export function AdminScreen(): ReactNode {
  return (
    <section className="screen">
      <PageHeader
        title="Administration"
        description="Users, roles and the availability of every professional."
      />
      <UsersPanel />
      <AvailabilityPanel />
    </section>
  );
}

function UsersPanel(): ReactNode {
  const [page, setPage] = useState(1);
  const users = useApiResource<PaginatedUsers>((signal) => listUsers(page, signal), [page]);

  const [email, setEmail] = useState('');
  const [createRoles, setCreateRoles] = useState<RoleName[]>(['patient']);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [savingUserId, setSavingUserId] = useState<number | undefined>(undefined);
  const [draftRoles, setDraftRoles] = useState<Record<number, RoleName[]>>({});

  const toggle = (roles: RoleName[], role: RoleName): RoleName[] =>
    roles.includes(role) ? roles.filter((value) => value !== role) : [...roles, role];

  const onCreate = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(undefined);
    setActionError(undefined);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (createRoles.length === 0) {
      setFormError('Select at least one role.');
      return;
    }

    setCreating(true);
    try {
      await createUser(email.trim(), createRoles);
      setEmail('');
      setCreateRoles(['patient']);
      users.reload();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setCreating(false);
    }
  };

  const onSaveRoles = async (user: AdminUser): Promise<void> => {
    const roles = draftRoles[user.id] ?? user.roles;
    setActionError(undefined);
    if (roles.length === 0) {
      setActionError('A user must keep at least one role.');
      return;
    }
    setSavingUserId(user.id);
    try {
      await updateUserRoles(user.id, roles);
      setDraftRoles((current) => {
        const next = { ...current };
        delete next[user.id];
        return next;
      });
      users.reload();
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setSavingUserId(undefined);
    }
  };

  return (
    <section className="card">
      <h2 className="section-title">Users and roles</h2>

      {actionError === undefined ? null : (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
      )}

      <form className="stack" onSubmit={(event) => void onCreate(event)} noValidate>
        <label htmlFor="admin-user-email">New user email</label>
        <input
          id="admin-user-email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <fieldset className="role-picker">
          <legend>Roles</legend>
          {ROLE_NAMES.map((role) => (
            <label key={role} className="checkbox">
              <input
                type="checkbox"
                name="roles"
                value={role}
                checked={createRoles.includes(role)}
                onChange={() => setCreateRoles((current) => toggle(current, role))}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </fieldset>

        {formError === undefined ? null : <ErrorBanner message={formError} />}

        <button type="submit" className="primary" disabled={creating}>
          {creating ? 'Creating…' : 'Create user'}
        </button>
        <FieldHint>The new account uses the seeded default password.</FieldHint>
      </form>

      {users.loading ? <LoadingIndicator label="Loading users…" /> : null}

      {users.error === undefined ? null : (
        <ErrorBanner message={users.error} onDismiss={users.reload} />
      )}

      {!users.loading && users.error === undefined && (users.data?.items.length ?? 0) === 0 ? (
        <EmptyState message="No users on this page." />
      ) : null}

      {users.data !== undefined && users.data.items.length > 0 ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Roles</th>
                <th scope="col">Active</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.data.items.map((user) => {
                const roles = draftRoles[user.id] ?? user.roles;
                return (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>
                      <div className="role-picker">
                        {ROLE_NAMES.map((role) => (
                          <label key={role} className="checkbox">
                            <input
                              type="checkbox"
                              checked={roles.includes(role)}
                              onChange={() =>
                                setDraftRoles((current) => ({
                                  ...current,
                                  [user.id]: toggle(roles, role),
                                }))
                              }
                            />
                            {ROLE_LABELS[role]}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>{user.active ? 'Yes' : 'No'}</td>
                    <td>
                      <button
                        type="button"
                        disabled={savingUserId === user.id || draftRoles[user.id] === undefined}
                        onClick={() => void onSaveRoles(user)}
                      >
                        {savingUserId === user.id ? 'Saving…' : 'Save roles'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="pagination">
            <button
              type="button"
              className="secondary"
              disabled={users.data.page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </button>
            <span className="muted">
              Page {users.data.page} of {users.data.totalPages} · {users.data.total} users
            </span>
            <button
              type="button"
              className="secondary"
              disabled={users.data.page >= users.data.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

interface SlotDraft {
  day: string;
  from: string;
  to: string;
}

function AvailabilityPanel(): ReactNode {
  const professionals = useApiResource<ProfessionalSummary[]>(
    (signal) => listProfessionals(signal),
    [],
  );

  const [professionalId, setProfessionalId] = useState('');
  const [drafts, setDrafts] = useState<SlotDraft[]>([
    { day: todayIso(), from: '08:00', to: '16:00' },
  ]);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (professionalId !== '' || professionals.data === undefined) {
      return;
    }
    const first = professionals.data[0];
    if (first !== undefined) {
      setProfessionalId(String(first.id));
    }
  }, [professionalId, professionals.data]);

  const updateDraft = (index: number, patch: Partial<SlotDraft>): void => {
    setDrafts((current) =>
      current.map((draft, position) => (position === index ? { ...draft, ...patch } : draft)),
    );
  };

  const addDraft = (): void => {
    setDrafts((current) => [...current, { day: addDaysIso(todayIso(), 1), from: '08:00', to: '16:00' }]);
  };

  const removeDraft = (index: number): void => {
    setDrafts((current) => current.filter((_, position) => position !== index));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(undefined);
    setActionError(undefined);
    setSuccessMessage(undefined);

    const id = Number.parseInt(professionalId, 10);
    if (!Number.isFinite(id) || id < 1) {
      setFormError('Select a professional.');
      return;
    }
    if (drafts.length === 0) {
      setFormError('Add at least one slot.');
      return;
    }

    const slots: Slot[] = [];
    for (const draft of drafts) {
      if (!isValidIsoDate(draft.day)) {
        setFormError(`Enter a valid date for the slot ${draft.day}.`);
        return;
      }
      if (!/^\d{2}:\d{2}$/.test(draft.from) || !/^\d{2}:\d{2}$/.test(draft.to)) {
        setFormError('Enter the slot times as HH:MM.');
        return;
      }
      if (draft.to <= draft.from) {
        setFormError('The end time must be after the start time.');
        return;
      }
      slots.push({
        start: isoFromDayAndTime(draft.day, draft.from),
        end: isoFromDayAndTime(draft.day, draft.to),
      });
    }

    setSaving(true);
    try {
      const stored = await replaceAvailability(id, slots);
      setSuccessMessage(
        `Availability replaced: ${stored.length} slot${stored.length === 1 ? '' : 's'} stored.`,
      );
    } catch (cause) {
      setActionError(describeError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <h2 className="section-title">Professional availability</h2>
      <p className="muted">
        The submitted set replaces the professional’s slots (EP-18). Overlapping slots are
        rejected by the server with a 422.
      </p>

      {professionals.error === undefined ? null : (
        <ErrorBanner message={professionals.error} onDismiss={professionals.reload} />
      )}

      {professionals.loading ? (
        <LoadingIndicator label="Loading the professional directory…" />
      ) : (
        <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
          <label className="field">
            <span>Professional</span>
            <select
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

          <div className="slot-editor">
            {drafts.map((draft, index) => (
              <div key={`${draft.day}-${index}`} className="slot-editor-row">
                <label className="field">
                  <span>Day</span>
                  <input
                    type="date"
                    value={draft.day}
                    onChange={(event) => updateDraft(index, { day: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>From</span>
                  <input
                    type="time"
                    value={draft.from}
                    onChange={(event) => updateDraft(index, { from: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>To</span>
                  <input
                    type="time"
                    value={draft.to}
                    onChange={(event) => updateDraft(index, { to: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="secondary"
                  disabled={drafts.length === 1}
                  onClick={() => removeDraft(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="button-row">
            <button type="button" className="secondary" onClick={addDraft}>
              Add slot
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Replacing…' : 'Replace availability'}
            </button>
          </div>

          {formError === undefined ? null : <ErrorBanner message={formError} />}
          {actionError === undefined ? null : (
            <ErrorBanner message={actionError} onDismiss={() => setActionError(undefined)} />
          )}
          {successMessage === undefined ? null : (
            <p className="state state-success" role="status">
              {successMessage}
            </p>
          )}

          <FieldHint>
            Example: {formatDayLabel(todayIso())} ·{' '}
            {formatSlot(
              isoFromDayAndTime(todayIso(), '08:00'),
              isoFromDayAndTime(todayIso(), '16:00'),
            )}
          </FieldHint>
        </form>
      )}
    </section>
  );
}
