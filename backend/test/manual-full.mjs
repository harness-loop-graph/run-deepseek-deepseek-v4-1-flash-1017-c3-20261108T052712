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

function auth(tokens) {
  return { authorization: `Bearer ${tokens.access_token}` };
}

async function call(method, path, tokens, body, extraHeaders = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(tokens ? auth(tokens) : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text, json: text ? safe(text) : undefined, headers: res.headers };
}

function safe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const patient = await login('paciente1@seed.local');
  const patient2 = await login('paciente2@seed.local');
  const gomez = await login('gomez@seed.local');
  const lopez = await login('lopez@seed.local');
  const staff = await login('staff@seed.local');
  const admin = await login('admin@seed.local');

  const from = isoDate(new Date());
  const to = isoDate(new Date(Date.now() + 13 * 86400000));
  const avail = await call('GET', `/availability?professionalId=1&from=${from}&to=${to}`, patient);
  console.log('availability', avail.status, Array.isArray(avail.json) ? avail.json.length : avail.text.slice(0, 200), avail.json?.[0]);

  const badRange = await call('GET', `/availability?professionalId=1&from=${to}&to=${from}`, patient);
  console.log('availability invalid range', badRange.status, badRange.text);

  const undeclared = await call('GET', `/availability?professionalId=1&bogus=1`, patient);
  console.log('availability undeclared', undeclared.status, undeclared.text);

  const slot = avail.json[0];
  const booked = await call('POST', '/appointments', patient, { professionalId: 1, slotStart: slot.start });
  console.log('book', booked.status, booked.text);
  const dup = await call('POST', '/appointments', patient2, { professionalId: 1, slotStart: slot.start });
  console.log('book dup', dup.status, dup.text);
  const badBody = await call('POST', '/appointments', patient, { professionalId: 1, slotStart: slot.start, extra: true });
  console.log('book undeclared', badBody.status, badBody.text);

  const mine = await call('GET', '/me/appointments', patient);
  console.log('me/appointments', mine.status, mine.json?.length, mine.json?.[0]);

  const apptId = booked.json.id;
  const detail = await call('GET', `/appointments/${apptId}`, patient);
  console.log('detail patient', detail.status, detail.text.slice(0, 300));
  const detailOther = await call('GET', `/appointments/${apptId}`, patient2);
  console.log('detail other patient', detailOther.status, detailOther.text);
  const detailLopez = await call('GET', `/appointments/${apptId}`, lopez);
  console.log('detail unassigned professional', detailLopez.status, detailLopez.text);
  const detailGomez = await call('GET', `/appointments/${apptId}`, gomez);
  console.log('detail assigned professional', detailGomez.status, detailGomez.text.slice(0, 200));
  const detailStaff = await call('GET', `/appointments/${apptId}`, staff);
  console.log('detail staff', detailStaff.status, detailStaff.text);

  const agenda = await call('GET', `/agenda?from=${from}&to=${to}`, gomez);
  console.log('agenda gomez', agenda.status, JSON.stringify(agenda.json).slice(0, 300));
  const agendaStaff = await call('GET', `/agenda?from=${from}&to=${to}&professionalId=1`, staff);
  console.log('agenda staff', agendaStaff.status, JSON.stringify(agendaStaff.json).slice(0, 200));
  const agendaPatient = await call('GET', `/agenda?from=${from}&to=${to}`, patient);
  console.log('agenda patient', agendaPatient.status, agendaPatient.text);

  const enc = await call('POST', `/appointments/${apptId}/encounter`, gomez, {
    notes: 'Paciente refiere cefalea',
    diagnosis: 'Migraña',
  });
  console.log('encounter', enc.status, enc.text);
  const encWrong = await call('POST', `/appointments/${apptId}/encounter`, lopez, {
    notes: 'x',
    diagnosis: 'y',
  });
  console.log('encounter wrong professional', encWrong.status, encWrong.text);

  const history = await call('GET', '/patients/1/clinical-history', patient);
  console.log('history patient', history.status, JSON.stringify(history.json).slice(0, 400));
  const historyOther = await call('GET', '/patients/1/clinical-history', patient2);
  console.log('history other patient', historyOther.status, historyOther.text);
  const historyStaff = await call('GET', '/patients/1/clinical-history', staff);
  console.log('history staff', historyStaff.status, historyStaff.text);
  const historyGomez = await call('GET', '/patients/1/clinical-history', gomez);
  console.log('history gomez', historyGomez.status, historyGomez.text.slice(0, 200));
  const historyLopez = await call('GET', '/patients/1/clinical-history', lopez);
  console.log('history lopez', historyLopez.status, historyLopez.text);

  // attachment
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'informe.pdf');
  const encId = enc.json.id;
  const up = await fetch(`${base}/encounters/${encId}/attachments`, {
    method: 'POST',
    headers: auth(gomez),
    body: form,
  });
  console.log('attachment upload', up.status, (await up.text()).slice(0, 300));

  const badForm = new FormData();
  badForm.append('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'notes.txt');
  const badUp = await fetch(`${base}/encounters/${encId}/attachments`, {
    method: 'POST',
    headers: auth(gomez),
    body: badForm,
  });
  console.log('attachment bad type', badUp.status, (await badUp.text()).slice(0, 200));

  const history2 = await call('GET', '/patients/1/clinical-history', patient);
  const attachments = history2.json?.encounters?.flatMap((e) => e.attachments ?? []) ?? [];
  console.log('attachments in history', attachments);
  if (attachments.length > 0) {
    const dl = await fetch(`${base}/attachments/${attachments[0].id}`, { headers: auth(patient) });
    console.log('download patient', dl.status, dl.headers.get('content-type'), (await dl.arrayBuffer()).byteLength);
    const dlOther = await fetch(`${base}/attachments/${attachments[0].id}`, { headers: auth(patient2) });
    console.log('download other patient', dlOther.status);
    const dlStaff = await fetch(`${base}/attachments/${attachments[0].id}`, { headers: auth(staff) });
    console.log('download staff', dlStaff.status);
  }

  const users = await call('GET', '/admin/users?page=1', admin);
  console.log('admin users', users.status, JSON.stringify(users.json).slice(0, 400));
  const usersForbidden = await call('GET', '/admin/users?page=1', patient);
  console.log('admin users forbidden', usersForbidden.status, usersForbidden.text);

  const created = await call('POST', '/admin/users', admin, { email: 'nuevo@seed.local', roles: ['staff'] });
  console.log('create user', created.status, created.text);
  const createdDup = await call('POST', '/admin/users', admin, { email: 'nuevo@seed.local', roles: ['staff'] });
  console.log('create user dup', createdDup.status, createdDup.text);
  const createdBadRole = await call('POST', '/admin/users', admin, { email: 'otro@seed.local', roles: ['nope'] });
  console.log('create user bad role', createdBadRole.status, createdBadRole.text);

  if (created.json?.id) {
    const patched = await call('PATCH', `/admin/users/${created.json.id}/roles`, admin, { roles: ['patient'] });
    console.log('patch roles', patched.status, patched.text);
    const patchBad = await call('PATCH', `/admin/users/${created.json.id}/roles`, admin, { roles: ['nope'] });
    console.log('patch roles bad', patchBad.status, patchBad.text);
  }

  const availPut = await call('PUT', '/admin/professionals/2/availability', admin, {
    slots: [
      { start: '2030-01-07T08:00:00.000Z', end: '2030-01-07T08:30:00.000Z' },
      { start: '2030-01-07T08:30:00.000Z', end: '2030-01-07T09:00:00.000Z' },
    ],
  });
  console.log('put availability', availPut.status, availPut.text.slice(0, 300));
  const availOverlap = await call('PUT', '/admin/professionals/2/availability', admin, {
    slots: [
      { start: '2030-01-07T08:00:00.000Z', end: '2030-01-07T09:00:00.000Z' },
      { start: '2030-01-07T08:30:00.000Z', end: '2030-01-07T09:30:00.000Z' },
    ],
  });
  console.log('put availability overlap', availOverlap.status, availOverlap.text.slice(0, 300));

  const audit = await call('GET', '/admin/audit?page=1', admin);
  console.log('audit', audit.status, JSON.stringify(audit.json).slice(0, 500));
  const auditFiltered = await call('GET', '/admin/audit?action=encounter_created', admin);
  console.log('audit filtered', auditFiltered.status, JSON.stringify(auditFiltered.json).slice(0, 300));

  const cancel = await call('DELETE', `/appointments/${apptId}`, patient);
  console.log('cancel', cancel.status, cancel.text);
  const cancelOther = await call('DELETE', `/appointments/${apptId}`, patient2);
  console.log('cancel other', cancelOther.status, cancelOther.text);
  const cancelMissing = await call('DELETE', '/appointments/99999', patient);
  console.log('cancel missing', cancelMissing.status, cancelMissing.text);

  const noToken = await call('GET', '/me/appointments', undefined);
  console.log('no token', noToken.status, noToken.text);

  const refresh = await fetch(`${base}/auth/token/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: patient.refresh_token }),
  });
  console.log('refresh', refresh.status, Object.keys(await refresh.json()));
  const revoke = await fetch(`${base}/auth/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth(patient) },
    body: JSON.stringify({ token: patient.refresh_token }),
  });
  console.log('revoke', revoke.status);
  const afterRevoke = await call('GET', '/me/appointments', patient);
  console.log('after revoke', afterRevoke.status, afterRevoke.text);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
