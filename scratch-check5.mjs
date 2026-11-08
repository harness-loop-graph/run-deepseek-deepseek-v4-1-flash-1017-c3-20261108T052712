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

const g = await login('gomez@seed.local');
const p3 = await login('paciente3@seed.local');
const p2 = await login('paciente2@seed.local');
const slots = await (await fetch(`${base}/availability?professionalId=1&from=2026-11-17&to=2026-11-17`, { headers: h(p3.access_token) })).json();
const book = await (await fetch(`${base}/appointments`, { method: 'POST', headers: { ...h(p3.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ professionalId: 1, slotStart: slots[0].start }) })).json();
const enc = await (await fetch(`${base}/appointments/${book.id}/encounter`, { method: 'POST', headers: { ...h(g.access_token), 'content-type': 'application/json' }, body: JSON.stringify({ notes: 'n', diagnosis: 'd' }) })).json();
const form = new FormData();
form.append('file', new Blob([Buffer.from('%PDF-1.4\n%test')], { type: 'application/pdf' }), '../../evil.pdf');
const up = await fetch(`${base}/encounters/${enc.id}/attachments`, { method: 'POST', headers: h(g.access_token), body: form });
const upBody = await up.text();
console.log('upload', up.status, upBody.slice(0, 200));
const id = JSON.parse(upBody).id;
const own = await fetch(`${base}/attachments/${id}`, { headers: h(p3.access_token) });
console.log('own download', own.status, own.headers.get('content-disposition'), own.headers.get('content-type'));
const other = await fetch(`${base}/attachments/${id}`, { headers: h(p2.access_token) });
console.log('other patient download', other.status);
const staff = await login('staff@seed.local');
console.log('staff download', (await fetch(`${base}/attachments/${id}`, { headers: h(staff.access_token) })).status);
const hist = await fetch(`${base}/patients/3/clinical-history`, { headers: h(p3.access_token) });
const histBody = await hist.text();
console.log('history has attachment', hist.status, histBody.includes('attachment'), histBody.slice(0, 300));
