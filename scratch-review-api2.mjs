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
const show = async (label, r) => console.log(label, r.status, (await r.text()).slice(0, 160));

const gomez = await toks('gomez@seed.local');
const lopez = await toks('lopez@seed.local');
const p3 = await toks('paciente3@seed.local');
const staff = await toks('staff@seed.local');

// encounter 12 belongs to appointment 24 (p3), authored by gomez
await show('EP-13 lopez uploads to gomez encounter', await (async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf');
  return fetch(base + '/encounters/12/attachments', { method: 'POST', headers: { authorization: 'Bearer ' + lopez.access_token }, body: fd });
})());
await show('EP-13 patient uploads', await (async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf');
  return fetch(base + '/encounters/12/attachments', { method: 'POST', headers: { authorization: 'Bearer ' + p3.access_token }, body: fd });
})());
await show('EP-11 patient records encounter', await call(p3.access_token, '/appointments/24/encounter', 'POST', { notes: 'a', diagnosis: 'b' }));
await show('EP-11 gomez on p3 appt', await call(gomez.access_token, '/appointments/24/encounter', 'POST', { notes: 'a', diagnosis: 'b' }));
await show('EP-11 empty notes', await call(gomez.access_token, '/appointments/24/encounter', 'POST', { notes: '', diagnosis: 'b' }));
await show('EP-17 patient calls roles', await call(p3.access_token, '/admin/users/3/roles', 'PATCH', { roles: ['admin'] }));
await show('EP-18 patient calls availability', await call(p3.access_token, '/admin/professionals/1/availability', 'PUT', { slots: [] }));
await show('EP-19 staff audit', await call(staff.access_token, '/admin/audit'));
await show('EP-15 patient users', await call(p3.access_token, '/admin/users'));
await show('EP-08 cancel twice', await call(p3.access_token, '/appointments/25', 'DELETE'));
await show('EP-08 cancel twice again', await call(p3.access_token, '/appointments/25', 'DELETE'));
await show('EP-07 past slot', await call(p3.access_token, '/appointments', 'POST', { professionalId: 1, slotStart: '2020-01-06T08:00:00.000Z' }));
await show('EP-07 unaligned slot', await call(p3.access_token, '/appointments', 'POST', { professionalId: 1, slotStart: '2026-11-27T08:17:00.000Z' }));
await show('EP-07 bad professional', await call(p3.access_token, '/appointments', 'POST', { professionalId: 999, slotStart: '2026-11-27T08:00:00.000Z' }));
await show('EP-10 missing id', await call(p3.access_token, '/appointments/999999'));
await show('EP-12 nonexistent patient', await call(gomez.access_token, '/patients/9999/clinical-history'));
await show('EP-14 missing attachment', await call(p3.access_token, '/attachments/99999'));
