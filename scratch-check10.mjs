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
const admin = await login('admin@seed.local');
const all = await (await fetch(`${base}/admin/audit?page=1`, { headers: h(admin.access_token) })).json();
const actions = [...new Set(all.items.map((i) => i.action))];
console.log('actions', actions.join(','));
const actors = [...new Set(all.items.map((i) => `${i.actor.id}:${i.actor.email}`))];
console.log('actors', actors.join(' | '));
for (const q of ['actor=2', 'actor=gomez@seed.local', 'action=encounter.create', 'from=2026-11-08&to=2026-11-09']) {
  const r = await fetch(`${base}/admin/audit?${q}`, { headers: h(admin.access_token) });
  const b = await r.json();
  console.log('query', q, r.status, b.items?.length);
}
