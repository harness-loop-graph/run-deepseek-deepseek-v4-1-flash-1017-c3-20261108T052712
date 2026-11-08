import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { session } from '../auth/session';
import { useSession } from '../auth/useSession';
import type { RoleName } from '../api/types';

/**
 * Application shell: role-driven navigation (RF-20) plus the session controls.
 *
 * Each role sees exactly the navigation items of the SPEC table and no other
 * `nav-*` element:
 *
 * | Role         | Items                                          |
 * | ------------ | ---------------------------------------------- |
 * | patient      | nav-bookings, nav-search, nav-history          |
 * | professional | nav-agenda, nav-history                        |
 * | staff        | nav-agenda, nav-search                         |
 * | admin        | nav-admin, nav-audit                           |
 */

interface NavItem {
  testId: string;
  to: string;
  label: string;
}

const NAV_BY_ROLE: Record<RoleName, readonly NavItem[]> = {
  patient: [
    { testId: 'nav-bookings', to: '/appointments', label: 'My appointments' },
    { testId: 'nav-search', to: '/search', label: 'Book an appointment' },
    { testId: 'nav-history', to: '/history', label: 'My clinical history' },
  ],
  professional: [
    { testId: 'nav-agenda', to: '/agenda', label: 'Agenda' },
    { testId: 'nav-history', to: '/history', label: 'Clinical history' },
  ],
  staff: [
    { testId: 'nav-agenda', to: '/agenda', label: 'Agenda' },
    { testId: 'nav-search', to: '/search', label: 'Availability search' },
  ],
  admin: [
    { testId: 'nav-admin', to: '/admin', label: 'Administration' },
    { testId: 'nav-audit', to: '/audit', label: 'Audit log' },
  ],
};

const ROLE_LABELS: Record<RoleName, string> = {
  patient: 'Patient',
  professional: 'Professional',
  staff: 'Administrative staff',
  admin: 'Administrator',
};

export function AppShell(): ReactNode {
  const { identity } = useSession();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const primaryRole = identity?.primaryRole ?? 'patient';
  const items = NAV_BY_ROLE[primaryRole];

  const onLogout = async (): Promise<void> => {
    setLoggingOut(true);
    await session.logout();
    setLoggingOut(false);
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✚
          </span>
          <span>Medical Appointments</span>
        </div>
        <nav className="app-nav" aria-label="Main navigation">
          {items.map((item) => (
            <NavLink
              key={item.testId}
              to={item.to}
              data-testid={item.testId}
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="session-box">
          <span className="role-badge">{ROLE_LABELS[primaryRole]}</span>
          <button type="button" className="secondary" onClick={onLogout} disabled={loggingOut}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
