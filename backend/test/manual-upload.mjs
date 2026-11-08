// Temporary probe: odd multipart payloads against EP-13.
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

async function main() {
  const gomez = await login('gomez@seed.local');
  const headers = { authorization: `Bearer ${gomez.access_token}` };
  const history = await fetch(`${base}/patients/1/clinical-history`, { headers });
  const body = await history.json();
  const encounterId = body.encounters[0]?.id;
  console.log('encounter', encounterId);
  if (encounterId === undefined) return;

  for (const mimetype of ['constructor', 'toString', 'image/gif', 'application/octet-stream']) {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: mimetype }), 'x.pdf');
    const res = await fetch(`${base}/encounters/${encounterId}/attachments`, {
      method: 'POST',
      headers,
      body: form,
    });
    console.log(mimetype, res.status, (await res.text()).slice(0, 200));
  }

  // two files
  const two = new FormData();
  two.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'a.pdf');
  two.append('file', new Blob([Buffer.from('%PDF-1.4 y')], { type: 'application/pdf' }), 'b.pdf');
  const twoRes = await fetch(`${base}/encounters/${encounterId}/attachments`, {
    method: 'POST',
    headers,
    body: two,
  });
  console.log('two files', twoRes.status, (await twoRes.text()).slice(0, 200));

  // alternate field name
  const alt = new FormData();
  alt.append('attachment', new Blob([Buffer.from('%PDF-1.4 z')], { type: 'application/pdf' }), 'c.pdf');
  const altRes = await fetch(`${base}/encounters/${encounterId}/attachments`, {
    method: 'POST',
    headers,
    body: alt,
  });
  console.log('alt field', altRes.status, (await altRes.text()).slice(0, 200));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
