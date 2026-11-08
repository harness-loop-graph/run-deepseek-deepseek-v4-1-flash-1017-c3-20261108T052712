// Temporary manual smoke script (deleted after verification).
const base = 'http://localhost:3000';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function main() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = 'st-123';
  const authorizeUrl = `${base}/auth/authorize?response_type=code&client_id=medapp-spa&redirect_uri=${encodeURIComponent('http://localhost:8080/auth/callback')}&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`;
  const res1 = await fetch(authorizeUrl, { redirect: 'manual' });
  console.log('authorize', res1.status, res1.headers.get('location'));
  const loginPage = await fetch(base + res1.headers.get('location'));
  const html = await loginPage.text();
  console.log('login page', loginPage.status, html.includes('name="email"'), html.includes('name="password"'));

  const form = new URLSearchParams({
    response_type: 'code',
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    email: 'paciente1@seed.local',
    password: 'Seed!Passw0rd',
  });
  const res2 = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  console.log('login', res2.status, res2.headers.get('location'));
  const location = res2.headers.get('location');
  if (!location) {
    console.log((await res2.text()).slice(0, 500));
    return;
  }
  const code = new URL(location).searchParams.get('code');
  const tokenRes = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: verifier,
      client_id: 'medapp-spa',
      redirect_uri: 'http://localhost:8080/auth/callback',
    }),
  });
  console.log('token', tokenRes.status);
  const tokens = await tokenRes.json();
  console.log(Object.keys(tokens));

  const me = await fetch(`${base}/me/appointments`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  console.log('me/appointments', me.status, (await me.text()).slice(0, 300));

  const profs = await fetch(`${base}/professionals`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  console.log('professionals', profs.status, (await profs.text()).slice(0, 300));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
