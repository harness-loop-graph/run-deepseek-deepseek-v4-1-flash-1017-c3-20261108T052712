// Temporary smoke check #7: full patient -> professional -> patient flow. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

async function newSession(email, password = 'Seed!Passw0rd') {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').waitFor();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  return { context, page };
}

// Patient books the first free slot of the default search.
const patient = await newSession('paciente3@seed.local');
await patient.page.waitForURL(/\/appointments/, { timeout: 20000 });
await patient.page.getByTestId('nav-search').click();
await patient.page.getByTestId('search-submit').click();
await patient.page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
const slotStart = await patient.page.getByTestId('slot-item').first().getAttribute('data-slot-start');
const professionalValue = await patient.page.getByTestId('search-professional').inputValue();
await patient.page.getByTestId('slot-item').first().click();
await patient.page.getByTestId('book-submit').click();
await patient.page.waitForURL(/\/appointments/, { timeout: 20000 });
await patient.page.getByTestId('appointment-item').first().waitFor();
const appointmentId = await patient.page
  .getByTestId('appointment-item')
  .first()
  .getAttribute('data-appointment-id');
console.log('booked', slotStart, 'professional', professionalValue, 'appointment', appointmentId);

// Cancel it again, then book a fresh one for the encounter flow.
await patient.page
  .locator(`[data-appointment-id="${appointmentId}"] [data-testid="cancel-appointment"]`)
  .click();
await patient.page.waitForTimeout(1500);
const statusAfterCancel = await patient.page
  .locator(`[data-appointment-id="${appointmentId}"]`)
  .innerText();
console.log('after cancel:', statusAfterCancel.replace(/\n+/g, ' | '));

await patient.page.getByTestId('nav-search').click();
await patient.page.getByTestId('search-submit').click();
await patient.page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
await patient.page.getByTestId('slot-item').first().click();
await patient.page.getByTestId('book-submit').click();
await patient.page.waitForURL(/\/appointments/, { timeout: 20000 });
await patient.page.getByTestId('appointment-item').first().waitFor();
const freshId = await patient.page
  .getByTestId('appointment-item')
  .first()
  .getAttribute('data-appointment-id');
console.log('fresh appointment', freshId);
await patient.context.close();

// Professional records the encounter.
const pro = await newSession(professionalValue === '2' ? 'lopez@seed.local' : 'gomez@seed.local');
await pro.page.waitForURL(/\/agenda/, { timeout: 20000 });
await pro.page.getByTestId('appointment-item').first().waitFor({ timeout: 20000 });
const agendaIds = await pro.page
  .locator('[data-testid="appointment-item"]')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-appointment-id')));
console.log('agenda ids', agendaIds.join(','));
await pro.page.locator(`[data-appointment-id="${freshId}"]`).click();
await pro.page.getByTestId('encounter-notes').fill('Seguimiento: dolor lumbar. <b>no html</b>');
await pro.page.getByTestId('encounter-diagnosis').fill('Lumbalgia mecánica');
await pro.page.getByTestId('encounter-submit').click();
await pro.page.locator('.encounter-card').first().waitFor({ timeout: 20000 });
console.log('encounters after save:', await pro.page.locator('.encounter-card').count());
await pro.page.getByTestId('nav-history').click();
await pro.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
console.log(
  'pro history:',
  (await pro.page.getByTestId('history-timeline').innerText()).replace(/\n+/g, ' | ').slice(0, 200),
);
await pro.context.close();

// Patient reads their own history.
const back = await newSession('paciente3@seed.local');
await back.page.waitForURL(/\/appointments/, { timeout: 20000 });
await back.page.getByTestId('nav-history').click();
await back.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
const timeline = await back.page.getByTestId('history-timeline').innerText();
console.log('patient timeline:', timeline.replace(/\n+/g, ' | ').slice(0, 250));
console.log('injected <b> elements:', await back.page.locator('history-timeline b').count());
await back.context.close();

// Role navigation and staff isolation.
for (const email of ['staff@seed.local', 'admin@seed.local', 'gomez@seed.local']) {
  const s = await newSession(email);
  await s.page.waitForURL(/\/agenda|\/admin/, { timeout: 20000 });
  await s.page.waitForTimeout(1500);
  const navs = await s.page
    .locator('[data-testid^="nav-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));
  console.log(email, '->', new URL(s.page.url()).pathname, navs.join(','));
  await s.context.close();
}

// Anonymous deep link.
const anon = await browser.newContext();
const anonPage = await anon.newPage();
await anonPage.goto('http://localhost:8080/history');
await anonPage.getByTestId('login-email').waitFor({ timeout: 10000 });
console.log('anonymous /history ->', new URL(anonPage.url()).pathname);
await anon.close();

await browser.close();
