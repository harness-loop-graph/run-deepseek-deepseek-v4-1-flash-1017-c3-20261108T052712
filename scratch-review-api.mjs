const base = 'http://localhost:3000';
import crypto from 'node:crypto';

async function toks(email) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = 'response_type=code&client_id=medapp-spa&redirect_uri=' + encodeURIComponent('http://localhost:8080/auth/callback') +
    '&code_challenge=' + challenge + '&code_challenge_method=S256&state=s1';
  const r = await fetch(base + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: q + '&email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent('Seed!Passw0rd'),
  });
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  return fetch(base + '/auth/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
  }).then((x) => x.json());
}

const call = (t, path, method = 'GET', body) =>
  fetch(base + path, {
    method,
    headers: { authorization: 'Bearer ' + t, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const admin = await toks('admin@seed.local');
const staff = await toks('staff@seed.local');
const gomez = await toks('gomez@seed.local');
const lopez = await toks('lopez@seed.local');
const p1 = await toks('paciente1@seed.local');
const p3 = await toks('paciente3@seed.local');

const show = async (label, r) => console.log(label, r.status, (await r.text()).slice(0, 200));

await show('EP-15 page=1', await call(admin.access_token, '/admin/users?page=1'));
await show('EP-15 page=abc', await call(admin.access_token, '/admin/users?page=abc'));
await show('EP-16 create', await call(admin.access_token, '/admin/users', 'POST', { email: 'review' + Date.now() + '@seed.local', roles: ['staff'] }));
await show('EP-17 unknown role', await call(admin.access_token, '/admin/users/3/roles', 'PATCH', { roles: ['wizard'] }));
await show('EP-17 ok', await call(admin.access_token, '/admin/users/3/roles', 'PATCH', { roles: ['patient'] }));
await show('EP-19 bad date', await call(admin.access_token, '/admin/audit?from=notadate'));
await show('EP-10 pro reads unassigned appt', await call(lopez.access_token, '/appointments/24'));
await show('EP-10 staff reads appt', await call(staff.access_token, '/appointments/24'));
await show('EP-09 staff agenda w/ professionalId', await call(staff.access_token, '/agenda?professionalId=1&from=2026-11-09&to=2026-11-10'));
await show('EP-09 professional other id', await call(lopez.access_token, '/agenda?professionalId=1&from=2026-11-09&to=2026-11-10'));
await show('EP-06 staff availability', await call(staff.access_token, '/availability?professionalId=1&from=2026-11-09&to=2026-11-10'));
await show('EP-05 staff', await call(staff.access_token, '/me/appointments'));
await show('EP-12 p1 own', await call(p1.access_token, '/patients/1/clinical-history'));
await show('EP-12 p1 other', await call(p1.access_token, '/patients/3/clinical-history'));
await show('EP-13 too large', await (async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(6 * 1024 * 1024)], { type: 'application/pdf' }), 'big.pdf');
  return fetch(base + '/encounters/12/attachments', { method: 'POST', headers: { authorization: 'Bearer ' + gomez.access_token }, body: fd });
})());
await show('refresh', await fetch(base + '/auth/token/refresh', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refresh_token: p3.refresh_token }),
}));
await show('refresh garbage', await fetch(base + '/auth/token/refresh', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ refresh_token: 'nope' }),
}));
await show('revoke bad token', await fetch(base + '/auth/revoke', {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + p3.access_token },
  body: JSON.stringify({ token: 'nope' }),
}));
await show('expired access', await fetch(base + '/me/appointments', { headers: { authorization: 'Bearer abc.def.ghi' } }));
await show('404 unknown route', await fetch(base + '/nope'));
