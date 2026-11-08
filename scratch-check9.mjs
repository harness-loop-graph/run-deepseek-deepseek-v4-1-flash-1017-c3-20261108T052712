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
const p = await login('paciente1@seed.local');
const g = await login('gomez@seed.local');
const slots = await (await fetch(`${base}/availability?professionalId=1&from=2026-11-19&to=2026-11-24`, { headers: h(p.access_token) })).json();
const appt = await (await fetch(`${base}/appointments`, { method: 'POST', headers: h(p.access_token), body: JSON.stringify({ professionalId: 1, slotStart: slots[0].start }) })).json();
const e1 = await (await fetch(`${base}/appointments/${appt.id}/encounter`, { method: 'POST', headers: h(g.access_token), body: JSON.stringify({ notes: 'v1', diagnosis: 'd1' }) })).json();
const e2 = await (await fetch(`${base}/appointments/${appt.id}/encounter`, { method: 'POST', headers: h(g.access_token), body: JSON.stringify({ notes: 'v2', diagnosis: 'd2' }) })).json();
console.log('versions', e1.version, e2.version, e2.replacesId);
const hist = await (await fetch(`${base}/patients/1/clinical-history`, { headers: h(p.access_token) })).json();
console.log('history encounters for appt', hist.encounters.filter((e) => e.appointmentId === appt.id).map((e) => `${e.version}:${e.notes}`));
// audit for encounter write
const admin = await login('admin@seed.local');
const audit = await (await fetch(`${base}/admin/audit?actor=2&action=encounter.create`, { headers: h(admin.access_token) })).json();
console.log('audit filtered', audit.items?.length, JSON.stringify(audit.items?.[0] ?? {}).slice(0, 160));
