// Temporary manual smoke script (deleted after verification).
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
  const location = res.headers.get('location');
  if (!location) throw new Error(`login failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const code = new URL(location).searchParams.get('code');
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
    redirect: 'manual',
  });
  return { status: res.status, text: (await res.text()).slice(0, 200) };
}

async function main() {
  const patient = await login('paciente1@seed.local');
  const gomez = await login('gomez@seed.local');
  const admin = await login('admin@seed.local');

  console.log('authorize unknown param', (await call('GET', '/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=s&bogus=1')).status);
  console.log('authorize wrong client', (await call('GET', '/auth/authorize?response_type=code&client_id=other&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback&code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=s')).status);
  console.log('agenda unknown param', await call('GET', '/agenda?bogus=1', gomez));
  console.log('admin users unknown param', await call('GET', '/admin/users?bogus=1', admin));
  console.log('admin audit unknown param', await call('GET', '/admin/audit?bogus=1', admin));
  console.log('detail missing', await call('GET', '/appointments/999999', patient));
  console.log('history missing patient', await call('GET', '/patients/999999/clinical-history', patient));
  console.log('encounter missing appointment', await call('POST', '/appointments/999999/encounter', gomez, { notes: 'n', diagnosis: 'd' }));
  console.log('encounter undeclared field', await call('POST', '/appointments/1/encounter', gomez, { notes: 'n', diagnosis: 'd', extra: 1 }));
  console.log('encounter empty notes', await call('POST', '/appointments/1/encounter', gomez, { notes: '', diagnosis: 'd' }));
  console.log('me appointments professional', await call('GET', '/me/appointments', gomez));
  console.log('availability missing professionalId', await call('GET', '/availability', patient));
  console.log('availability bad professional', await call('GET', '/availability?professionalId=999', patient));
  console.log('availability bad date', await call('GET', '/availability?professionalId=1&from=01-01-2026', patient));
  console.log('admin users page 0', await call('GET', '/admin/users?page=0', admin));
  console.log('create user no roles', await call('POST', '/admin/users', admin, { email: 'x@seed.local' }));
  console.log('create user bad email', await call('POST', '/admin/users', admin, { email: 'not-an-email', roles: ['staff'] }));
  console.log('put availability empty', await call('PUT', '/admin/professionals/1/availability', admin, { slots: [] }));
  console.log('put availability unknown professional', await call('PUT', '/admin/professionals/999/availability', admin, { slots: [{ start: '2031-01-06T08:00:00.000Z', end: '2031-01-06T08:30:00.000Z' }] }));
  console.log('patch roles missing user', await call('PATCH', '/admin/users/999999/roles', admin, { roles: ['staff'] }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
