// Temporary concurrency probe: two simultaneous bookings of the same slot.
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
  const code = new URL(res.headers.get('location')).searchParams.get('code');
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
  return tokenRes.json();
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const p1 = await login('paciente2@seed.local');
  const p2 = await login('paciente3@seed.local');
  const from = isoDate(new Date());
  const to = isoDate(new Date(Date.now() + 13 * 86400000));
  const avail = await fetch(`${base}/availability?professionalId=2&from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${p1.access_token}` },
  });
  const slots = await avail.json();
  console.log('lopez slots', slots.length);

  for (const slot of slots.slice(0, 5)) {
    const results = await Promise.all(
      [p1, p2].map(async (tokens) => {
        const res = await fetch(`${base}/appointments`, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ professionalId: 2, slotStart: slot.start }),
        });
        return res.status;
      }),
    );
    console.log(slot.start, results.sort());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
