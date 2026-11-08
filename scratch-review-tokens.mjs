const base = 'http://localhost:3000';
import crypto from 'node:crypto';

async function codeFor(email) {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const q = 'response_type=code&client_id=medapp-spa&redirect_uri=' + encodeURIComponent('http://localhost:8080/auth/callback') +
    '&code_challenge=' + challenge + '&code_challenge_method=S256&state=s1';
  const r = await fetch(base + '/auth/login', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: q + '&email=' + encodeURIComponent(email) + '&password=' + encodeURIComponent('Seed!Passw0rd'),
  });
  const code = new URL(r.headers.get('location')).searchParams.get('code');
  return { code, verifier };
}

const exchange = (code, verifier) => fetch(base + '/auth/token', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
});

const { code, verifier } = await codeFor('paciente2@seed.local');
let r = await exchange(code, 'wrong-verifier-value-that-is-long-enough-000');
console.log('wrong verifier', r.status, (await r.text()).slice(0, 120));
r = await exchange('not-a-real-code', verifier);
console.log('invalid code', r.status, (await r.text()).slice(0, 120));
r = await exchange(code, verifier);
console.log('replay used code', r.status, (await r.text()).slice(0, 120));
r = await exchange(code, verifier);
console.log('replay again', r.status, (await r.text()).slice(0, 120));

// booking rate limit (10/min per user)
const { code: c2, verifier: v2 } = await codeFor('paciente2@seed.local');
const t = await exchange(c2, v2).then((x) => x.json());
const statuses = [];
for (let i = 0; i < 13; i += 1) {
  const res = await fetch(base + '/appointments', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t.access_token },
    body: JSON.stringify({ professionalId: 1, slotStart: '2026-11-30T0' + (i % 10) + ':00:00.000Z' }),
  });
  statuses.push(res.status + ':' + (res.headers.get('retry-after') ?? '-'));
}
console.log('booking attempts', statuses.join(' '));
