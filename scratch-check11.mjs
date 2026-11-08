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
const g = await login('gomez@seed.local');
const admin = await login('admin@seed.local');

// booking rate limit: 10/min per user
let last;
for (let i = 0; i < 12; i += 1) {
  const r = await fetch(`${base}/appointments`, { method: 'POST', headers: h(p.access_token), body: JSON.stringify({ professionalId: 1, slotStart: `2026-11-26T0${8 + Math.floor(i / 2)}:${i % 2 === 0 ? '00' : '30'}:00.000Z` }) });
  last = r;
  if (i >= 9) console.log('book rate', i, r.status, r.headers.get('retry-after'));
}
// create an encounter + attachment and check audit actions
const slots = await (await fetch(`${base}/availability?professionalId=1&from=2026-11-27&to=2026-11-27`, { headers: h(p.access_token) })).json();
const appt = await (await fetch(`${base}/appointments`, { method: 'POST', headers: h(p.access_token), body: JSON.stringify({ professionalId: 1, slotStart: slots[0].start }) })).json();
const enc = await (await fetch(`${base}/appointments/${appt.id}/encounter`, { method: 'POST', headers: h(g.access_token), body: JSON.stringify({ notes: 'a', diagnosis: 'b' }) })).json();
const form = new FormData();
form.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'doc.pdf');
await fetch(`${base}/encounters/${enc.id}/attachments`, { method: 'POST', headers: h(g.access_token), body: form });
await fetch(`${base}/appointments/${appt.id}`, { method: 'DELETE', headers: h(p.access_token) });
const audit = await (await fetch(`${base}/admin/audit?page=1`, { headers: h(admin.access_token) })).json();
console.log('actions', [...new Set(audit.items.map((i) => i.action))].join(','));
