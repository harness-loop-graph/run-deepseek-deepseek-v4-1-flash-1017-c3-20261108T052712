import crypto from 'node:crypto';

const base = 'http://localhost:3000';
async function login(email) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = 'st' + Math.random();
  const body = new URLSearchParams({
    response_type: 'code', client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge, code_challenge_method: 'S256', state,
    email, password: 'Seed!Passw0rd',
  });
  const r = await fetch(`${base}/auth/login`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  const t = await fetch(`${base}/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }) });
  const j = await t.json();
  return j;
}

const h = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

// patient1 books a slot with gomez (professional 1), then gomez records encounter
const p1 = await login('paciente1@seed.local');
const g = await login('gomez@seed.local');
const slots = await (await fetch(`${base}/availability?professionalId=1&from=2026-11-12&to=2026-11-12`, { headers: h(p1.access_token) })).json();
console.log('slots 11-12:', slots.length, slots[0]);
const book = await fetch(`${base}/appointments`, { method: 'POST', headers: h(p1.access_token), body: JSON.stringify({ professionalId: 1, slotStart: slots[0].start }) });
const created = await book.json();
console.log('book', book.status, created);
const enc = await fetch(`${base}/appointments/${created.id}/encounter`, { method: 'POST', headers: h(g.access_token), body: JSON.stringify({ notes: 'Headache for three days', diagnosis: 'Tension headache' }) });
console.log('encounter', enc.status, (await enc.text()).slice(0, 150));
const hist = await fetch(`${base}/patients/1/clinical-history`, { headers: h(p1.access_token) });
const histBody = await hist.text();
console.log('history', hist.status, histBody.slice(0, 220));
// staff reads agenda
const s = await login('staff@seed.local');
const ag = await fetch(`${base}/agenda?professionalId=1&from=2026-11-09&to=2026-11-16`, { headers: h(s.access_token) });
console.log('staff agenda', ag.status, (await ag.text()).slice(0, 100));
// staff books
const staffBook = await fetch(`${base}/appointments`, { method: 'POST', headers: h(s.access_token), body: JSON.stringify({ professionalId: 1, slotStart: slots[1].start }) });
console.log('staff book', staffBook.status, (await staffBook.text()).slice(0, 100));
// patient cancels own
const cancel = await fetch(`${base}/appointments/${created.id}`, { method: 'DELETE', headers: h(p1.access_token) });
console.log('cancel', cancel.status);
// refresh + revoke
const ref = await fetch(`${base}/auth/token/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: p1.refresh_token }) });
console.log('refresh', ref.status);
const rv = await fetch(`${base}/auth/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: p1.access_token }) });
console.log('revoke', rv.status);
const after = await fetch(`${base}/me/appointments`, { headers: h(p1.access_token) });
console.log('after revoke', after.status);
