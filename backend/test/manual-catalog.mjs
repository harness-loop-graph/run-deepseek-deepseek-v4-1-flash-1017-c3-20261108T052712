// Temporary probe of the remaining catalog endpoints (deleted after verification).
const base = 'http://localhost:3000';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function login(email, password = 'Seed!Passw0rd') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st',
    email,
    password,
  });
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  const code = new URL(res.headers.get('location')).searchParams.get('code');
  const tokenRes = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      client_id: 'medapp-spa',
      redirect_uri: 'http://localhost:8080/auth/callback',
    }),
  });
  if (tokenRes.status !== 200) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
  return tokenRes.json();
}

async function call(method, path, tokens, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(tokens ? { authorization: `Bearer ${tokens.access_token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const admin = await login('admin@seed.local');
  const staff = await login('staff@seed.local');
  const gomez = await login('gomez@seed.local');

  console.log('staff agenda no id', (await call('GET', '/agenda', staff)).status);
  const staffAgenda = await call('GET', '/agenda?professionalId=1', staff);
  console.log('staff agenda id=1', staffAgenda.status, staffAgenda.text.slice(0, 120));
  console.log('staff agenda unknown prof', (await call('GET', '/agenda?professionalId=99', staff)).status);
  console.log('pros', (await call('GET', '/professionals', staff)).text.slice(0, 200));

  console.log('users page 2', (await call('GET', '/admin/users?page=2', admin)).text.slice(0, 160));
  console.log('users page 0', (await call('GET', '/admin/users?page=0', admin)).status);
  console.log('patch unknown user', (await call('PATCH', '/admin/users/9999/roles', admin, { roles: ['staff'] })).status);
  console.log('create user no roles', (await call('POST', '/admin/users', admin, { email: 'z@seed.local' })).status);
  console.log('create user bad email', (await call('POST', '/admin/users', admin, { email: 'nope', roles: ['staff'] })).status);

  const auditByEmail = await call('GET', '/admin/audit?actor=gomez@seed.local', admin);
  console.log('audit actor email', auditByEmail.status, auditByEmail.text.slice(0, 200));
  const auditByDate = await call('GET', '/admin/audit?from=2020-01-01&to=2030-01-01&page=1', admin);
  console.log('audit date range', auditByDate.status, auditByDate.text.slice(0, 160));
  console.log('audit bad date', (await call('GET', '/admin/audit?from=01-01-2020', admin)).status);

  const put = await call('PUT', '/admin/professionals/1/availability', admin, {
    slots: [
      { start: '2031-02-03T08:00:00.000Z', end: '2031-02-03T08:30:00.000Z' },
      { start: '2031-02-03T09:00:00.000Z', end: '2031-02-03T09:30:00.000Z' },
    ],
  });
  console.log('put availability prof1', put.status, put.text.slice(0, 200));
  console.log('put availability unknown prof', (await call('PUT', '/admin/professionals/99/availability', admin, { slots: [] })).status);
  console.log('put availability bad shape', (await call('PUT', '/admin/professionals/1/availability', admin, { slots: [{ start: 'nope', end: 'nope' }] })).status);

  console.log('agenda pro own', (await call('GET', '/agenda', gomez)).status);
  console.log('pro bookings', (await call('GET', '/me/appointments', gomez)).status);
  console.log('history unknown patient', (await call('GET', '/patients/999/clinical-history', gomez)).status);
  console.log('attachment missing', (await call('GET', '/attachments/9999', gomez)).status);
  console.log('encounter missing appt', (await call('POST', '/appointments/9999/encounter', gomez, { notes: 'a', diagnosis: 'b' })).status);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
