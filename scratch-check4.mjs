import crypto from 'node:crypto';
const base = 'http://localhost:3000';
async function login(email) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const body = new URLSearchParams({
    response_type: 'code', client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge, code_challenge_method: 'S256', state: 's1',
    email, password: 'Seed!Passw0rd',
  });
  const r = await fetch(`${base}/auth/login`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  const t = await fetch(`${base}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }) });
  return t.json();
}
const h = (t) => ({ authorization: `Bearer ${t}` });

// rate limit on auth endpoints (5/min per IP)
for (let i = 0; i < 0; i += 1) {
  const r = await fetch(`${base}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'x', code_verifier: 'y', client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }) });
  if (i === 6 || i === 7) console.log('auth rate limit', i, r.status, r.headers.get('retry-after'));
}

const g = await login('gomez@seed.local');
const p = await login('paciente3@seed.local');
const admin = await login('admin@seed.local');

// admin users list + roles patch + availability replace
const users = await fetch(`${base}/admin/users?page=1`, { headers: h(admin.access_token) });
console.log('admin users', users.status, (await users.text()).slice(0, 100));
const createUser = await fetch(`${base}/admin/users`, { method: 'POST', headers: { ...h(admin.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ email: `new${Date.now()}@seed.local`, roles: ['staff'] }) });
console.log('admin create user', createUser.status, (await createUser.text()).slice(0, 120));
const badRole = await fetch(`${base}/admin/users`, { method: 'POST', headers: { ...h(admin.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x@y.z', roles: ['wizard'] }) });
console.log('bad role', badRole.status, (await badRole.text()).slice(0, 100));
const availPut = await fetch(`${base}/admin/professionals/2/availability`, { method: 'PUT', headers: { ...h(admin.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ slots: [{ start: '2026-11-20T08:00:00.000Z', end: '2026-11-20T08:30:00.000Z' }] }) });
console.log('availability put', availPut.status, (await availPut.text()).slice(0, 120));
const overlap = await fetch(`${base}/admin/professionals/2/availability`, { method: 'PUT', headers: { ...h(admin.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ slots: [{ start: '2026-11-21T08:00:00.000Z', end: '2026-11-21T09:00:00.000Z' }, { start: '2026-11-21T08:30:00.000Z', end: '2026-11-21T09:30:00.000Z' }] }) });
console.log('overlap', overlap.status, (await overlap.text()).slice(0, 120));

// attachment upload on encounter 1 (patient1's) by gomez
const slots = await (await fetch(`${base}/availability?professionalId=1&from=2026-11-13&to=2026-11-13`, { headers: h(p.access_token) })).json();
const book = await fetch(`${base}/appointments`, { method: 'POST', headers: { ...h(p.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ professionalId: 1, slotStart: slots[0].start }) });
const created = await book.json();
const enc = await fetch(`${base}/appointments/${created.id}/encounter`, { method: 'POST', headers: { ...h(g.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'note', diagnosis: 'dx' }) });
const encBody = await enc.json();
const form = new FormData();
form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'text/plain' }), 'a.txt');
const bad = await fetch(`${base}/encounters/${encBody.id}/attachments`, { method: 'POST', headers: h(g.access_token), body: form });
console.log('bad attachment type', bad.status, (await bad.text()).slice(0, 100));
const form2 = new FormData();
form2.append('file', new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }), '../../evil.pdf');
const ok = await fetch(`${base}/encounters/${encBody.id}/attachments`, { method: 'POST', headers: h(g.access_token), body: form2 });
const okBody = await ok.text();
console.log('pdf attachment', ok.status, okBody.slice(0, 160));
