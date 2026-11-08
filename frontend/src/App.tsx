import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import type { RoleName } from './api/types';
import { AppShell } from './components/AppShell';
import { useSession } from './auth/useSession';
import { ProtectedRoute, landingFor } from './routes/ProtectedRoute';
import { AdminScreen } from './screens/AdminScreen';
import { AgendaScreen } from './screens/AgendaScreen';
import { AppointmentDetailScreen } from './screens/AppointmentDetailScreen';
import { AuditScreen } from './screens/AuditScreen';
import { AvailabilitySearchScreen } from './screens/AvailabilitySearchScreen';
import { ClinicalHistoryScreen } from './screens/ClinicalHistoryScreen';
import { CallbackScreen, LoginScreen } from './screens/LoginScreen';
import { PatientAppointmentsScreen } from './screens/PatientAppointmentsScreen';

/**
 * Route table of the SPA (SCR-01 .. SCR-08, RF-20).
 *
 * `/login` and `/auth/callback` are the only public routes: the callback is the
 * registered `redirect_uri`, so it must stay reachable while the session is
 * still anonymous. Every other route is wrapped in `ProtectedRoute`, which
 * redirects an anonymous visitor to SCR-01 and a session without the required
 * role to its own landing screen.
 */

const ALL_ROLES: readonly RoleName[] = ['patient', 'professional', 'staff', 'admin'];

/** `/` sends an authenticated session to the landing screen of its role. */
function HomeRedirect(): ReactNode {
  const { identity } = useSession();
  return <Navigate to={landingFor(identity?.roles ?? [])} replace />;
}

/** Unknown deep link: back to `/`, which then routes by role. */
function UnknownRoute(): ReactNode {
  return <Navigate to="/" replace />;
}

export function App(): ReactNode {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/auth/callback" element={<CallbackScreen />} />

        <Route element={<ProtectedRoute roles={ALL_ROLES} />}>
          <Route element={<AppShell />}>
            <Route index element={<HomeRedirect />} />

            {/* SCR-02: patient portal. */}
            <Route
              path="/appointments"
              element={
                <ProtectedRoute roles={['patient']}>
                  <PatientAppointmentsScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-05: appointment detail and encounter recording. */}
            <Route
              path="/appointments/:id"
              element={
                <ProtectedRoute roles={['patient', 'professional']}>
                  <AppointmentDetailScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-03: availability search and booking (scheduling data only). */}
            <Route
              path="/search"
              element={
                <ProtectedRoute roles={['patient', 'staff']}>
                  <AvailabilitySearchScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-04: professional agenda. */}
            <Route
              path="/agenda"
              element={
                <ProtectedRoute roles={['professional', 'staff']}>
                  <AgendaScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-06: clinical history (never reachable by staff). */}
            <Route
              path="/history"
              element={
                <ProtectedRoute roles={['patient', 'professional']}>
                  <ClinicalHistoryScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-07: administration. */}
            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AdminScreen />
                </ProtectedRoute>
              }
            />

            {/* SCR-08: audit log query. */}
            <Route
              path="/audit"
              element={
                <ProtectedRoute roles={['admin']}>
                  <AuditScreen />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<UnknownRoute />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
