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
const j = await login('paciente1@seed.local');
const post = (b) => fetch(`${base}/auth/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const r1 = await post({ token: j.access_token });
console.log('revoke access via body.token', r1.status, (await r1.text()).slice(0, 120));
const j2 = await login('paciente2@seed.local');
const r2 = await fetch(`${base}/auth/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j2.access_token}` }, body: '{}' });
console.log('revoke with bearer header', r2.status, (await r2.text()).slice(0, 120));
console.log('use after revoke', (await fetch(`${base}/me/appointments`, { headers: { authorization: `Bearer ${j2.access_token}` } })).status);
const j3 = await login('paciente3@seed.local');
const r3 = await post({ refresh_token: j3.refresh_token });
console.log('revoke refresh via body.refresh_token', r3.status);
console.log('access after refresh revoke', (await fetch(`${base}/me/appointments`, { headers: { authorization: `Bearer ${j3.access_token}` } })).status);
