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
  const p1 = await login('paciente1@seed.local');
  const p2 = await login('paciente2@seed.local');
  const p3 = await login('paciente3@seed.local');

  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10);
  const availRes = await fetch(`${base}/availability?professionalId=1&from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${p1.access_token}` },
  });
  const slots = await availRes.json();
  console.log('slots', slots.length);
  const slot = slots[3];

  const attempts = await Promise.all(
    [p1, p2, p3].map((tokens) =>
      fetch(`${base}/appointments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.access_token}` },
        body: JSON.stringify({ professionalId: 1, slotStart: slot.start }),
      }).then(async (r) => ({ status: r.status, body: await r.text() })),
    ),
  );
  console.log('concurrent', attempts);

  // past slot booking
  const past = await fetch(`${base}/appointments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p1.access_token}` },
    body: JSON.stringify({ professionalId: 2, slotStart: '2020-01-06T08:00:00.000Z' }),
  });
  console.log('past booking', past.status, (await past.text()).slice(0, 200));

  // unavailable slot
  const lopezFriday = await fetch(`${base}/availability?professionalId=1&from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${p1.access_token}` },
  });
  const lopezSlots = await lopezFriday.json();
  const fridays = lopezSlots.filter((s) => new Date(s.start).getUTCDay() === 5);
  console.log('lopez friday slots', fridays.length);

  // 413 too large
  const gomez = await login('gomez@seed.local');
  const mine = await fetch(`${base}/me/appointments`, { headers: { authorization: `Bearer ${p1.access_token}` } });
  const appts = await mine.json();
  const apptId = appts[0].id;
  const enc = await fetch(`${base}/appointments/${apptId}/encounter`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${gomez.access_token}` },
    body: JSON.stringify({ notes: 'nota', diagnosis: 'diag' }),
  });
  console.log('encounter', enc.status, (await enc.text()).slice(0, 200));

  const big = new FormData();
  big.append('file', new Blob([Buffer.alloc(6 * 1024 * 1024, 1)], { type: 'application/pdf' }), 'big.pdf');
  const bigRes = await fetch(`${base}/encounters/1/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gomez.access_token}` },
    body: big,
  });
  console.log('big upload', bigRes.status, (await bigRes.text()).slice(0, 200));

  const noFile = new FormData();
  noFile.append('other', 'x');
  const noFileRes = await fetch(`${base}/encounters/1/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gomez.access_token}` },
    body: noFile,
  });
  console.log('no file upload', noFileRes.status, (await noFileRes.text()).slice(0, 200));

  const staff = await login('staff@seed.local');
  const staffUpload = new FormData();
  staffUpload.append('file', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'x.pdf');
  const staffUploadRes = await fetch(`${base}/encounters/1/attachments`, {
    method: 'POST',
    headers: { authorization: `Bearer ${staff.access_token}` },
    body: staffUpload,
  });
  console.log('staff upload', staffUploadRes.status, (await staffUploadRes.text()).slice(0, 200));

  const missingAttachment = await fetch(`${base}/attachments/9999`, {
    headers: { authorization: `Bearer ${p1.access_token}` },
  });
  console.log('missing attachment', missingAttachment.status, (await missingAttachment.text()).slice(0, 200));

  const notFoundRoute = await fetch(`${base}/nope`);
  console.log('unknown route', notFoundRoute.status, (await notFoundRoute.text()).slice(0, 200));

  const badJson = await fetch(`${base}/appointments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${p1.access_token}` },
    body: '{bad json',
  });
  console.log('bad json', badJson.status, (await badJson.text()).slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
