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
const lopez = await login('lopez@seed.local'); // professional 2, cardiology
const gomez = await login('gomez@seed.local');
const p1 = await login('paciente1@seed.local');

// patient 1's appointment 1 belongs to gomez; lopez must not read it
console.log('lopez appt1', (await fetch(`${base}/appointments/1`, { headers: h(lopez.access_token) })).status);
console.log('gomez appt1', (await fetch(`${base}/appointments/1`, { headers: h(gomez.access_token) })).status);
console.log('lopez history p1', (await fetch(`${base}/patients/1/clinical-history`, { headers: h(lopez.access_token) })).status);
console.log('lopez encounter on appt1', (await fetch(`${base}/appointments/1/encounter`, { method: 'POST', headers: h(lopez.access_token), body: JSON.stringify({ notes: 'x', diagnosis: 'y' }) })).status);
console.log('patient cancel other appt', (await fetch(`${base}/appointments/4`, { method: 'DELETE', headers: h(p1.access_token) })).status);
console.log('patient delete others encounter attempt', (await fetch(`${base}/appointments/2`, { headers: h(p1.access_token) })).status);
const noAuth = await fetch(`${base}/me/appointments`);
console.log('no auth', noAuth.status, (await noAuth.text()).slice(0, 80));
const badTok = await fetch(`${base}/me/appointments`, { headers: { authorization: 'Bearer nonsense' } });
console.log('bad token', badTok.status);
const staffWrite = await fetch(`${base}/appointments/1/encounter`, { method: 'POST', headers: h((await login('staff@seed.local')).access_token), body: JSON.stringify({ notes: 'a', diagnosis: 'b' }) });
console.log('staff encounter', staffWrite.status);
