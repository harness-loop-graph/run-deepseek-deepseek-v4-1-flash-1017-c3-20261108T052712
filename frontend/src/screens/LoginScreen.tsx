import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL, OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI } from '../config';
import {
  clearPendingAuthorization,
  createCodeChallenge,
  createCodeVerifier,
  createState,
  readPendingAuthorization,
} from '../auth/pkce';
import { landingFor } from '../routes/ProtectedRoute';
import { session } from '../auth/session';
import { useSession } from '../auth/useSession';
import { ErrorBanner, FieldHint, LoadingIndicator } from '../components/States';
import { describeError } from '../api/errors';

/**
 * SCR-01 — login and authorization return (RF-18, RF-20, RF-21, RF-23).
 *
 * The credentials never reach SPA code that stores them: the screen performs
 * the standard HTML form post of EP-01 (`/auth/login`) with the hidden
 * authorization request, so the authorization server — not the SPA — verifies
 * the password and answers 302 to `redirect_uri` with `code` and `state`.
 * The PKCE verifier stays in `sessionStorage`; only the S256 challenge travels.
 *
 * The post is sent with `fetch` so a rejected credential can be shown in the
 * SPA as `error-banner` (RF-21); if the browser refuses to follow the
 * cross-origin redirect, the same form is submitted natively, which always
 * works because a form post is not subject to CORS.
 *
 * `data-testid` contract: `login-email`, `login-password`, `login-submit`.
 */
export function LoginScreen(): ReactNode {
  const { status, identity, error } = useSession();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authorization, setAuthorization] = useState<
    { codeVerifier: string; codeChallenge: string; state: string } | undefined
  >(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const codeVerifier = createCodeVerifier();
    const state = createState();
    void createCodeChallenge(codeVerifier).then((codeChallenge) => {
      if (!active) {
        return;
      }
      sessionStorage.setItem(
        'medapp.pkce.pending',
        JSON.stringify({ codeVerifier, state, createdAt: Date.now() }),
      );
      setAuthorization({ codeVerifier, codeChallenge, state });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated' && identity !== undefined) {
      navigate(landingFor(identity.roles), { replace: true });
    }
  }, [status, identity, navigate]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError(undefined);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password === '') {
      setFormError('Enter your password.');
      return;
    }
    if (authorization === undefined) {
      setFormError('The authorization request is still being prepared. Try again.');
      return;
    }

    const body = new URLSearchParams({
      response_type: 'code',
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT_URI,
      code_challenge: authorization.codeChallenge,
      code_challenge_method: 'S256',
      state: authorization.state,
      email: email.trim(),
      password,
    });

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
      });

      const landing = response.url;
      if (response.ok && landing.includes('/auth/callback') && landing.includes('code=')) {
        // The authorization code is in the URL: let the SPA callback route
        // verify `state` and exchange it at EP-02.
        window.location.assign(landing);
        return;
      }

      const html = await response.text();
      setFormError(serverMessageOf(html) ?? 'Sign-in failed. Check your credentials.');
    } catch {
      // The browser refused to follow the redirect (CORS): fall back to the
      // native form post, which the authorization server handles identically.
      formRef.current?.submit();
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'initializing') {
    return (
      <div className="auth-page">
        <LoadingIndicator label="Restoring your session…" />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <main className="auth-card">
        <h1>Medical Appointments</h1>
        <p className="muted">Sign in to manage appointments and clinical history.</p>

        {error === undefined ? null : <ErrorBanner message={error} />}
        {formError === undefined ? null : <ErrorBanner message={formError} />}

        <form
          ref={formRef}
          className="stack"
          method="post"
          action={`${API_BASE_URL}/auth/login`}
          onSubmit={(event) => void onSubmit(event)}
          noValidate
        >
          {authorization === undefined ? null : (
            <>
              <input type="hidden" name="response_type" value="code" />
              <input type="hidden" name="client_id" value={OAUTH_CLIENT_ID} />
              <input type="hidden" name="redirect_uri" value={OAUTH_REDIRECT_URI} />
              <input type="hidden" name="code_challenge" value={authorization.codeChallenge} />
              <input type="hidden" name="code_challenge_method" value="S256" />
              <input type="hidden" name="state" value={authorization.state} />
            </>
          )}

          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            data-testid="login-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            data-testid="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button
            type="submit"
            data-testid="login-submit"
            disabled={authorization === undefined || submitting}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <FieldHint>
          Authorization code + PKCE (S256). The password is verified by the authorization server;
          the SPA only keeps a short-lived access token and a refresh token.
        </FieldHint>
      </main>
    </div>
  );
}

/**
 * Extracts the message of the server-rendered login form (EP-01).
 *
 * The HTML is parsed and only its text is read, so no markup from the response
 * can ever be injected into the SPA (RF-22).
 */
function serverMessageOf(html: string): string | undefined {
  try {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const banner = document.querySelector('[data-testid="error-banner"]');
    const text = banner?.textContent?.trim();
    return text === undefined || text === '' ? undefined : text;
  } catch {
    return undefined;
  }
}

/**
 * SCR-01 — authorization return (`/auth/callback`).
 *
 * Verifies `state` against the pending PKCE request, exchanges the
 * authorization code at EP-02 and routes by role (RF-18, RF-20).
 */
export function CallbackScreen(): ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

  const code = params.get('code');
  const state = params.get('state');
  const errorParam = params.get('error');

  useEffect(() => {
    let active = true;

    if (errorParam !== null) {
      setError(`The authorization server rejected the request: ${errorParam}`);
      return () => {
        active = false;
      };
    }
    if (code === null || state === null) {
      setError('The authorization response is incomplete.');
      return () => {
        active = false;
      };
    }

    const pending = readPendingAuthorization();
    if (pending === undefined) {
      setError('No authorization request is pending in this browser. Start again from the sign-in page.');
      return () => {
        active = false;
      };
    }
    if (pending.state !== state) {
      clearPendingAuthorization();
      setError('The authorization response does not match this browser session (state mismatch).');
      return () => {
        active = false;
      };
    }

    setError(undefined);
    session
      .completeAuthorization(code, pending.codeVerifier)
      .then((identity) => {
        if (!active) {
          return;
        }
        clearPendingAuthorization();
        navigate(landingFor(identity.roles), { replace: true });
      })
      .catch((cause: unknown) => {
        if (!active) {
          return;
        }
        clearPendingAuthorization();
        setError(describeError(cause));
      });

    return () => {
      active = false;
    };
  }, [code, state, errorParam, navigate, attempt]);

  return (
    <div className="auth-page">
      <main className="auth-card">
        <h1>Completing sign-in</h1>
        {error === undefined ? (
          <LoadingIndicator label="Exchanging the authorization code…" />
        ) : (
          <>
            <ErrorBanner message={error} />
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => navigate('/login', { replace: true })}
            >
              Back to sign-in
            </button>
          </>
        )}
      </main>
    </div>
  );
}
