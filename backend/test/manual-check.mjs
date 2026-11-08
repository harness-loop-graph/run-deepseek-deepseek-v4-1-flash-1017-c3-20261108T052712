// Temporary manual probe of edge cases against the running stack.
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

function auth(tokens) {
  return { authorization: `Bearer ${tokens.access_token}` };
}

async function call(method, path, tokens, body) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(tokens ? auth(tokens) : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const patient = await login('paciente1@seed.local');
  const gomez = await login('gomez@seed.local');

  const from = isoDate(new Date());
  const to = isoDate(new Date(Date.now() + 13 * 86400000));
  const avail = await call('GET', `/availability?professionalId=1&from=${from}&to=${to}`, patient);
  const slots = JSON.parse(avail.text);
  console.log('slots', slots.length);
  const slot = slots[0];
  const booked = await call('POST', '/appointments', patient, { professionalId: 1, slotStart: slot.start });
  console.log('book', booked.status, booked.text);
  const apptId = JSON.parse(booked.text).id;

  const enc = await call('POST', `/appointments/${apptId}/encounter`, gomez, {
    notes: 'Nota',
    diagnosis: 'Diag',
  });
  console.log('encounter', enc.status, enc.text);
  const encId = JSON.parse(enc.text).id;

  // 413: 6 MB pdf
  const big = Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(6 * 1024 * 1024, 0x20)]);
  const form = new FormData();
  form.append('file', new Blob([big], { type: 'application/pdf' }), 'big.pdf');
  const bigRes = await fetch(`${base}/encounters/${encId}/attachments`, {
    method: 'POST',
    headers: auth(gomez),
    body: form,
  });
  console.log('big upload', bigRes.status, (await bigRes.text()).slice(0, 200));

  // 422: no file
  const emptyForm = new FormData();
  emptyForm.append('other', 'x');
  const noFile = await fetch(`${base}/encounters/${encId}/attachments`, {
    method: 'POST',
    headers: auth(gomez),
    body: emptyForm,
  });
  console.log('no file', noFile.status, (await noFile.text()).slice(0, 200));

  // traversal filename
  const trav = new FormData();
  trav.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), '../../etc/passwd.pdf');
  const travRes = await fetch(`${base}/encounters/${encId}/attachments`, {
    method: 'POST',
    headers: auth(gomez),
    body: trav,
  });
  console.log('traversal name', travRes.status, (await travRes.text()).slice(0, 250));

  // bad json body
  const badJson = await fetch(`${base}/appointments`, {
    method: 'POST',
    headers: { ...auth(patient), 'content-type': 'application/json' },
    body: '{not json',
  });
  console.log('bad json', badJson.status, (await badJson.text()).slice(0, 200));

  // unknown route
  const unknown = await call('GET', '/nope', patient);
  console.log('unknown route', unknown.status, unknown.text);

  // unknown query param on appointments
  const unknownQuery = await call('GET', `/appointments/${apptId}?x=1`, patient);
  console.log('unknown query', unknownQuery.status, unknownQuery.text.slice(0, 150));

  // role escalation: patient tries admin endpoint
  const adminTry = await call('POST', '/admin/users', patient, { email: 'x@y.local', roles: ['admin'] });
  console.log('patient admin', adminTry.status, adminTry.text);

  // expired token behaviour simulated by bad token
  const badToken = await call('GET', '/me/appointments', { access_token: 'nope' });
  console.log('bad token', badToken.status, badToken.text);

  // duplicate encounter version behaviour (second recording -> version 2)
  const enc2 = await call('POST', `/appointments/${apptId}/encounter`, gomez, {
    notes: 'Corrección',
    diagnosis: 'Diag2',
  });
  console.log('encounter v2', enc2.status, enc2.text.slice(0, 250));

  // history has both versions
  const history = await call('GET', '/patients/1/clinical-history', patient);
  const parsed = JSON.parse(history.text);
  console.log(
    'history versions',
    parsed.encounters.filter((e) => e.appointmentId === apptId).map((e) => [e.version, e.replacesId]),
  );

  // rate limit: booking > 10/min
  let last = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await call('POST', '/appointments', patient, { professionalId: 1, slotStart: slot.start });
    last = r.status;
    if (r.status === 429) {
      console.log('booking 429 at', i, r.headers.get('retry-after'), r.text.slice(0, 120));
      break;
    }
  }
  console.log('booking loop last status', last);

  // auth rate limit
  let authLast = 0;
  for (let i = 0; i < 8; i += 1) {
    const r = await fetch(`${base}/auth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'bad', code_verifier: 'x'.repeat(50), client_id: 'medapp-spa', redirect_uri: 'http://localhost:8080/auth/callback' }),
    });
    authLast = r.status;
    if (r.status === 429) {
      console.log('auth 429 at', i, r.headers.get('retry-after'), (await r.text()).slice(0, 120));
      break;
    }
  }
  console.log('auth loop last', authLast);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
