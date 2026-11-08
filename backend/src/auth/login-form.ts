/**
 * Minimal HTML escaping for the server-rendered login form (EP-01).
 *
 * Every value placed in the document goes through this helper, so a crafted
 * `state` or `code_challenge` can never break out of its attribute (RF-22 in
 * spirit: never inject unsanitized text into markup).
 */
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export interface LoginFormFields {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string;
}

/**
 * Renders the standard HTML login form of EP-01: hidden inputs carry the
 * authorization request, `input[name="email"]`, `input[name="password"]` and a
 * submit button make the flow automatable end-to-end.
 */
export function renderLoginForm(fields: LoginFormFields, error?: string): string {
  const hidden = (
    [
      ['response_type', fields.response_type],
      ['client_id', fields.client_id],
      ['redirect_uri', fields.redirect_uri],
      ['code_challenge', fields.code_challenge],
      ['code_challenge_method', fields.code_challenge_method],
      ['state', fields.state],
    ] as const
  )
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('\n      ');

  const errorBlock =
    error === undefined
      ? ''
      : `<p class="error" role="alert" data-testid="error-banner">${escapeHtml(error)}</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign in — Medical Appointments</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f5f7fa; margin: 0; }
      main { max-width: 22rem; margin: 4rem auto; background: #fff; padding: 2rem;
             border-radius: .75rem; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
      h1 { font-size: 1.25rem; margin: 0 0 1.5rem; }
      label { display: block; font-size: .875rem; margin-bottom: .25rem; }
      input[type="email"], input[type="password"] {
        width: 100%; box-sizing: border-box; padding: .5rem .625rem; margin-bottom: 1rem;
        border: 1px solid #cbd5e1; border-radius: .375rem; font-size: 1rem;
      }
      button { width: 100%; padding: .625rem; font-size: 1rem; border: 0; border-radius: .375rem;
               background: #1d4ed8; color: #fff; cursor: pointer; }
      .error { color: #b91c1c; background: #fee2e2; padding: .5rem .75rem; border-radius: .375rem;
               font-size: .875rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Medical Appointments</h1>
      ${errorBlock}
      <form method="post" action="/auth/login">
      ${hidden}
        <label for="email">Email</label>
        <input id="email" type="email" name="email" autocomplete="username" required>
        <label for="password">Password</label>
        <input id="password" type="password" name="password" autocomplete="current-password" required>
        <button type="submit">Sign in</button>
      </form>
    </main>
  </body>
</html>`;
}

export function renderLoginErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Authorization error</title></head>
  <body>
    <main>
      <h1>Authorization error</h1>
      <p data-testid="error-banner">${escapeHtml(message)}</p>
      <p><a href="/auth/authorize">Start over</a></p>
    </main>
  </body>
</html>`;
}
