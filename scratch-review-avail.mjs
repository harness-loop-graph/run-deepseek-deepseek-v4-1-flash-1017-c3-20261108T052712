const base = 'http://localhost:3000';
import crypto from 'node:crypto';

async function toks(email) {
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
  return fetch(base + '/auth/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
  }).then((x) => x.json());
}

const p = await toks('paciente1@seed.local');
for (const day of ['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-16']) {
  const r = await fetch(base + '/availability?professionalId=1&from=' + day + '&to=' + day, { headers: { authorization: 'Bearer ' + p.access_token } });
  const j = await r.json();
  console.log('prof1', day, Array.isArray(j) ? j.length + ' first=' + (j[0] && j[0].start) + ' last=' + (j[j.length - 1] && j[j.length - 1].end) : JSON.stringify(j));
}
for (const day of ['2026-11-13', '2026-11-16']) {
  const r = await fetch(base + '/availability?professionalId=2&from=' + day + '&to=' + day, { headers: { authorization: 'Bearer ' + p.access_token } });
  const j = await r.json();
  console.log('prof2', day, Array.isArray(j) ? j.length + ' first=' + (j[0] && j[0].start) : JSON.stringify(j));
}
