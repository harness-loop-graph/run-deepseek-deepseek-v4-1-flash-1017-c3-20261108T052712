import crypto from 'node:crypto';

const base = 'http://localhost:3000';
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = 'st' + Date.now();

const authUrl = `${base}/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=${encodeURIComponent('http://localhost:8080/auth/callback')}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
const r1 = await fetch(authUrl, { redirect: 'manual' });
console.log('authorize', r1.status, r1.headers.get('location')?.slice(0, 60));

const body = new URLSearchParams({
  response_type: 'code',
  client_id: 'medapp-spa',
  redirect_uri: 'http://localhost:8080/auth/callback',
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
  email: 'paciente1@seed.local',
  password: 'Seed!Passw0rd',
});
const r2 = await fetch(`${base}/auth/login`, {
  method: 'POST',
  body,
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  redirect: 'manual',
});
const loc = r2.headers.get('location') ?? '';
console.log('login', r2.status, loc.slice(0, 100));
const code = new URL(loc).searchParams.get('code');
console.log('code', code ? 'yes' : 'no');

const r3 = await fetch(`${base}/auth/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ code, code_verifier: verifier, client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
});
const tokens = await r3.json();
console.log('token', r3.status, Object.keys(tokens));
const access = tokens.access_token;

const me = await fetch(`${base}/me/appointments`, { headers: { authorization: `Bearer ${access}` } });
console.log('me/appointments', me.status, (await me.text()).slice(0, 200));

const meInfo = await fetch(`${base}/me`, { headers: { authorization: `Bearer ${access}` } });
console.log('me', meInfo.status, (await meInfo.text()).slice(0, 200));

const avail = await fetch(`${base}/availability?professionalId=1&from=2026-11-09&to=2026-11-16`, { headers: { authorization: `Bearer ${access}` } });
console.log('availability', avail.status, (await avail.text()).slice(0, 200));
