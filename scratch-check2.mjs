import crypto from 'node:crypto';

const base = 'http://localhost:3000';

async function login(email, password) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = 'st' + Math.random();
  const body = new URLSearchParams({
    response_type: 'code',
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    email,
    password,
  });
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  });
  const loc = r.headers.get('location') ?? '';
  const code = new URL(loc).searchParams.get('code');
  const t = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
  });
  const j = await t.json();
  return j.access_token;
}

const patient = await login('paciente2@seed.local', 'Seed!Passw0rd');
const staff = await login('staff@seed.local', 'Seed!Passw0rd');
const admin = await login('admin@seed.local', 'Seed!Passw0rd');
const gomez = await login('gomez@seed.local', 'Seed!Passw0rd');
console.log('tokens ok', Boolean(patient && staff && admin && gomez));

const h = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });

// undeclared field must be 422
const extra = await fetch(`${base}/appointments`, {
  method: 'POST', headers: h(patient),
  body: JSON.stringify({ professionalId: 1, slotStart: '2026-11-10T08:00:00.000Z', evil: 1 }),
});
console.log('undeclared field', extra.status, (await extra.text()).slice(0, 120));

// staff reading clinical content
const staffHist = await fetch(`${base}/patients/1/clinical-history`, { headers: h(staff) });
console.log('staff clinical-history', staffHist.status);

// patient reading other patient's history
const other = await fetch(`${base}/patients/1/clinical-history`, { headers: h(patient) });
console.log('cross-patient history', other.status);

// concurrent booking same slot
const slot = '2026-11-10T09:00:00.000Z';
const mk = () => fetch(`${base}/appointments`, { method: 'POST', headers: h(patient), body: JSON.stringify({ professionalId: 1, slotStart: slot }) });
const [a, b] = await Promise.all([mk(), mk()]);
console.log('concurrent', a.status, b.status, (await a.text()).slice(0, 80), (await b.text()).slice(0, 80));

// availability invalid range
const badRange = await fetch(`${base}/availability?professionalId=1&from=2026-11-20&to=2026-11-10`, { headers: h(patient) });
console.log('bad range', badRange.status, (await badRange.text()).slice(0, 120));

// audit as admin
const audit = await fetch(`${base}/admin/audit?page=1`, { headers: h(admin) });
console.log('audit', audit.status, (await audit.text()).slice(0, 150));

// agenda as professional
const agenda = await fetch(`${base}/agenda`, { headers: h(gomez) });
console.log('agenda', agenda.status, (await agenda.text()).slice(0, 150));
