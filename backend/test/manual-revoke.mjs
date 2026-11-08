// Temporary manual smoke script (deleted after verification).
const base = 'http://localhost:3000';

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function login(email, password = 'Seed!Passw0rd') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: 'medapp-spa',
    redirect_uri: 'http://localhost:8080/auth/callback',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'st',
    email,
    password,
  });
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  const location = res.headers.get('location');
  if (!location) throw new Error(`login failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
  if (tokenRes.status !== 200) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
  return tokenRes.json();
}

async function main() {
  const patient = await login('paciente1@seed.local');
  const revoke = await fetch(`${base}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${patient.access_token}` },
    body: JSON.stringify({ token: patient.refresh_token }),
  });
  console.log('revoke', revoke.status, (await revoke.text()).slice(0, 200));
  const after = await fetch(`${base}/me/appointments`, {
    headers: { authorization: `Bearer ${patient.access_token}` },
  });
  console.log('after revoke access', after.status, (await after.text()).slice(0, 200));
  const refreshAfter = await fetch(`${base}/auth/token/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: patient.refresh_token }),
  });
  console.log('refresh after revoke', refreshAfter.status, (await refreshAfter.text()).slice(0, 200));
  const revokeAgain = await fetch(`${base}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: patient.refresh_token }),
  });
  console.log('revoke again', revokeAgain.status, (await revokeAgain.text()).slice(0, 200));
  const revokeGarbage = await fetch(`${base}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'garbage-token' }),
  });
  console.log('revoke garbage', revokeGarbage.status, (await revokeGarbage.text()).slice(0, 200));
  const badToken = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'nope',
      code_verifier: 'a'.repeat(43),
      client_id: 'medapp-spa',
      redirect_uri: 'http://localhost:8080/auth/callback',
    }),
  });
  console.log('token bad code', badToken.status, (await badToken.text()).slice(0, 200));
  const badField = await fetch(`${base}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: 'nope',
      code_verifier: 'a'.repeat(43),
      client_id: 'medapp-spa',
      redirect_uri: 'http://localhost:8080/auth/callback',
      extra: 1,
    }),
  });
  console.log('token undeclared', badField.status, (await badField.text()).slice(0, 200));

  // rate limiting auth: 6 bad logins
  for (let i = 0; i < 7; i += 1) {
    const res = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: 'nope',
        code_verifier: 'a'.repeat(43),
        client_id: 'medapp-spa',
        redirect_uri: 'http://localhost:8080/auth/callback',
      }),
    });
    console.log('rate limit attempt', i + 1, res.status, res.headers.get('retry-after'));
    await res.text();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
