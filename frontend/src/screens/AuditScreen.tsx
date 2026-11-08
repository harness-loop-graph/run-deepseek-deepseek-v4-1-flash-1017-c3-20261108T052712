import { useState, type ReactNode } from 'react';
import { listAudit } from '../api/endpoints';
import type { AuditFilters, PaginatedAudit } from '../api/types';
import { EmptyState, ErrorBanner, LoadingIndicator, PageHeader } from '../components/States';
import { useApiResource } from '../hooks/useApiResource';
import { formatDateTime, isValidIsoDate } from '../utils/dates';

/**
 * SCR-08 — audit log query (EP-19).
 *
 * Filters: `actor` (user id or email), `action`, `from`, `to` and the page.
 * Only declared filters are sent, so an empty input never turns into a 422
 * (RF-12). The metadata column is rendered as JSON text, never as HTML.
 */
export function AuditScreen(): ReactNode {
  const [draft, setDraft] = useState<AuditFilters>({});
  const [applied, setApplied] = useState<AuditFilters>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const audit = useApiResource<PaginatedAudit>(
    (signal) => listAudit(applied, signal),
    [applied.actor, applied.action, applied.from, applied.to, applied.page],
  );

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(undefined);
    if (draft.from !== undefined && !isValidIsoDate(draft.from)) {
      setFormError('Enter the start date as YYYY-MM-DD.');
      return;
    }
    if (draft.to !== undefined && !isValidIsoDate(draft.to)) {
      setFormError('Enter the end date as YYYY-MM-DD.');
      return;
    }
    if (draft.from !== undefined && draft.to !== undefined && draft.from > draft.to) {
      setFormError('The start date must not be after the end date.');
      return;
    }
    setApplied({ ...draft, page: 1 });
  };

  const onReset = (): void => {
    setDraft({});
    setApplied({});
    setFormError(undefined);
  };

  const goToPage = (page: number): void => {
    setApplied((current) => ({ ...current, page }));
  };

  const items = audit.data?.items ?? [];
  const pagination = audit.data;

  return (
    <section className="screen">
      <PageHeader
        title="Audit log"
        description="Every write and every clinical read, newest first."
      />

      <form className="filter-bar" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span>Actor</span>
          <input
            name="actor"
            placeholder="email or user id"
            value={draft.actor ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, actor: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Action</span>
          <input
            name="action"
            placeholder="appointment.create"
            value={draft.action ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>From</span>
          <input
            type="date"
            name="from"
            value={draft.from ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>To</span>
          <input
            type="date"
            name="to"
            value={draft.to ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
          />
        </label>

        <button type="submit" className="primary">
          Query
        </button>
        <button type="button" className="secondary" onClick={onReset}>
          Reset
        </button>
      </form>

      {formError === undefined ? null : <ErrorBanner message={formError} />}

      {audit.loading ? <LoadingIndicator label="Loading the audit log…" /> : null}

      {audit.error === undefined ? null : (
        <ErrorBanner message={audit.error} onDismiss={audit.reload} />
      )}

      {!audit.loading && audit.error === undefined && items.length === 0 ? (
        <EmptyState message="No audit records match these filters." />
      ) : null}

      {items.length > 0 ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Actor</th>
                <th scope="col">Action</th>
                <th scope="col">Resource</th>
                <th scope="col">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {items.map((record) => (
                <tr key={record.id}>
                  <td>{formatDateTime(record.occurredAt)}</td>
                  <td>{record.actor.email}</td>
                  <td>
                    <code>{record.action}</code>
                  </td>
                  <td>
                    {record.resourceType}
                    {record.resourceId === null ? '' : ` #${record.resourceId}`}
                  </td>
                  <td>
                    <code className="metadata">{JSON.stringify(record.metadata)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {pagination === undefined ? null : (
            <div className="pagination">
              <button
                type="button"
                className="secondary"
                disabled={pagination.page <= 1}
                onClick={() => goToPage(Math.max(1, pagination.page - 1))}
              >
                Previous
              </button>
              <span className="muted">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
              </span>
              <button
                type="button"
                className="secondary"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => goToPage(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
