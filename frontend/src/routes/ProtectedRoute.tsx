import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../auth/useSession';
import { LoadingIndicator } from '../components/States';
import type { RoleName } from '../api/types';

/**
 * Protected routing (RF-20).
 *
 * An unauthenticated visitor of any SCR-02..08 route is redirected to SCR-01
 * (`/login`), and a session whose role is not allowed on the route is sent to
 * its own landing screen. Hiding a route is a convenience only: the server
 * re-authorises every request (RF-09, RF-10).
 *
 * It works both as a layout route (rendering `<Outlet />`) and as a wrapper
 * around a single screen (rendering its children).
 */
export function ProtectedRoute({
  roles,
  children,
}: {
  roles: readonly RoleName[];
  children?: ReactNode;
}): ReactNode {
  const { status, identity } = useSession();
  const location = useLocation();

  if (status === 'initializing') {
    return <LoadingIndicator label="Restoring your session…" />;
  }

  if (status !== 'authenticated' || identity === undefined) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const allowed = identity.roles.some((role) => roles.includes(role));
  if (!allowed) {
    return <Navigate to={landingFor(identity.roles)} replace />;
  }

  return children ?? <Outlet />;
}

/** Landing route of the first role the session holds. */
export function landingFor(roles: readonly RoleName[]): string {
  if (roles.includes('admin')) {
    return '/admin';
  }
  if (roles.includes('professional') || roles.includes('staff')) {
    return '/agenda';
  }
  return '/appointments';
}
