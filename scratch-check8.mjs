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
const h = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const p = await login('paciente2@seed.local');
const admin = await login('admin@seed.local');

console.log('patient agenda', (await fetch(`${base}/agenda`, { headers: h(p.access_token) })).status);
console.log('patient admin/users', (await fetch(`${base}/admin/users`, { headers: h(p.access_token) })).status);
console.log('patient audit', (await fetch(`${base}/admin/audit`, { headers: h(p.access_token) })).status);
const dup = await fetch(`${base}/admin/users`, { method: 'POST', headers: h(admin.access_token), body: JSON.stringify({ email: 'paciente1@seed.local', roles: ['patient'] }) });
console.log('dup user', dup.status, (await dup.text()).slice(0, 90));
const roles = await fetch(`${base}/admin/users/3/roles`, { method: 'PATCH', headers: h(admin.access_token), body: JSON.stringify({ roles: ['wizard'] }) });
console.log('unknown role patch', roles.status, (await roles.text()).slice(0, 90));
const unknown = await fetch(`${base}/appointments/99999`, { headers: h(p.access_token) });
console.log('unknown appt', unknown.status, (await unknown.text()).slice(0, 90));
const badAvail = await fetch(`${base}/availability?professionalId=abc&from=2026-11-10&to=2026-11-11`, { headers: h(p.access_token) });
console.log('bad professionalId', badAvail.status, (await badAvail.text()).slice(0, 90));
const missing = await fetch(`${base}/appointments`, { method: 'POST', headers: h(p.access_token), body: JSON.stringify({}) });
console.log('missing fields', missing.status, (await missing.text()).slice(0, 90));
const auditRead = await fetch(`${base}/admin/audit?action=clinical_history.read`, { headers: h(admin.access_token) });
const auditBody = await auditRead.text();
console.log('audit clinical read', auditRead.status, auditBody.slice(0, 200));
