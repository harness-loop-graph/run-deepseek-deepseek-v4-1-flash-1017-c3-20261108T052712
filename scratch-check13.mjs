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
const p = await login('paciente3@seed.local');
const r = await fetch(`${base}/availability?professionalId=1&from=2026-11-10&to=2026-11-11&bogus=1`, { headers: h(p.access_token) });
console.log('undeclared query', r.status, (await r.text()).slice(0, 90));
const r2 = await fetch(`${base}/auth/authorize?response_type=code&client_id=other&redirect_uri=http%3A%2F%2Fevil&code_challenge=x&code_challenge_method=S256&state=s`);
console.log('other client', r2.status, (await r2.text()).slice(0, 120));
const r3 = await fetch(`${base}/auth/authorize?response_type=token&client_id=medapp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback&code_challenge=x&code_challenge_method=S256&state=s`);
console.log('wrong response_type', r3.status, (await r3.text()).slice(0, 120));
const r4 = await fetch(`${base}/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fauth%2Fcallback&code_challenge=x&code_challenge_method=plain&state=s`);
console.log('plain method', r4.status, (await r4.text()).slice(0, 120));
