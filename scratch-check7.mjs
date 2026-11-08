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
const p = await login('paciente1@seed.local');
// Friday 2026-11-13: lopez must have no slots, gomez must have 16
for (const prof of [1, 2]) {
  const r = await fetch(`${base}/availability?professionalId=${prof}&from=2026-11-13&to=2026-11-13`, { headers: h(p.access_token) });
  console.log('friday prof', prof, r.status, (await r.json()).length);
}
for (const prof of [1, 2]) {
  const r = await fetch(`${base}/availability?professionalId=${prof}&from=2026-11-14&to=2026-11-14`, { headers: h(p.access_token) });
  console.log('saturday prof', prof, (await r.json()).length);
}
const profs = await fetch(`${base}/professionals`, { headers: h(p.access_token) });
console.log('professionals', profs.status, (await profs.text()).slice(0, 200));
