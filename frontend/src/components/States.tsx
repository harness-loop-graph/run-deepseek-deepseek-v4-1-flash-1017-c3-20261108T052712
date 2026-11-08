import type { ReactNode } from 'react';

/**
 * Shared view states (RF-24).
 *
 * Every API-consuming view renders exactly one of these at a time, and each
 * carries the `data-testid` fixed by the testability contract of SPEC.md:
 * `loading-indicator`, `error-banner`, `empty-state`.
 */

export function LoadingIndicator({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <p className="state state-loading" role="status" aria-live="polite" data-testid="loading-indicator">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): ReactNode {
  return (
    <div className="state state-error" role="alert" data-testid="error-banner">
      <span>{message}</span>
      {onDismiss === undefined ? null : (
        <button type="button" className="link-button" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }): ReactNode {
  return (
    <p className="state state-empty" data-testid="empty-state">
      {message}
    </p>
  );
}

/** Inline field hint used by the client-side part of the validation (RF-21). */
export function FieldHint({ children }: { children: ReactNode }): ReactNode {
  return <small className="field-hint">{children}</small>;
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}): ReactNode {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description === undefined ? null : <p className="muted">{description}</p>}
      </div>
      {children === undefined ? null : <div className="page-actions">{children}</div>}
    </header>
  );
}
