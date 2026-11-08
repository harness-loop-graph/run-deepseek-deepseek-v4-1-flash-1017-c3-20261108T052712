// Temporary smoke check #8: encounter + history flow inside the agenda window. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

async function newSession(email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').waitFor();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Seed!Passw0rd');
  await page.getByTestId('login-submit').click();
  return { context, page };
}

const patient = await newSession('paciente2@seed.local');
await patient.page.waitForURL(/\/appointments/, { timeout: 20000 });
await patient.page.getByTestId('nav-search').click();
await patient.page.getByTestId('search-submit').click();
await patient.page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
// Narrow the range to the agenda window (today..+7) so the professional sees it.
await patient.page.getByTestId('search-to').fill(new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10));
await patient.page.getByTestId('search-submit').click();
await patient.page.waitForTimeout(1500);
const slotStart = await patient.page.getByTestId('slot-item').first().getAttribute('data-slot-start');
await patient.page.getByTestId('slot-item').first().click();
await patient.page.getByTestId('book-submit').click();
await patient.page.waitForURL(/\/appointments/, { timeout: 20000 });
await patient.page.getByTestId('appointment-item').first().waitFor();
const ids = await patient.page
  .locator('[data-testid="appointment-item"]')
  .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-appointment-id'))));
const appointmentId = String(Math.max(...ids));
console.log('booked slot', slotStart, 'appointment', appointmentId);
await patient.context.close();

const pro = await newSession('gomez@seed.local');
await pro.page.waitForURL(/\/agenda/, { timeout: 20000 });
await pro.page.getByTestId('appointment-item').first().waitFor({ timeout: 20000 });
await pro.page.locator(`[data-appointment-id="${appointmentId}"]`).click();
await pro.page.getByTestId('encounter-notes').waitFor({ timeout: 20000 });
await pro.page.getByTestId('encounter-notes').fill('Dolor lumbar de 3 días. <b>no html</b>');
await pro.page.getByTestId('encounter-diagnosis').fill('Lumbalgia mecánica');
await pro.page.getByTestId('encounter-submit').click();
await pro.page.locator('.encounter-card').first().waitFor({ timeout: 20000 });
console.log('encounter cards:', await pro.page.locator('.encounter-card').count());
console.log('injected <b>:', await pro.page.locator('.encounter-card b').count());
await pro.page.getByTestId('nav-history').click();
await pro.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
console.log(
  'pro timeline:',
  (await pro.page.getByTestId('history-timeline').innerText()).replace(/\n+/g, ' | ').slice(0, 220),
);
await pro.context.close();

const back = await newSession('paciente2@seed.local');
await back.page.waitForURL(/\/appointments/, { timeout: 20000 });
await back.page.getByTestId('nav-history').click();
await back.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
console.log(
  'patient timeline:',
  (await back.page.getByTestId('history-timeline').innerText()).replace(/\n+/g, ' | ').slice(0, 220),
);
await back.context.close();

const admin = await newSession('admin@seed.local');
await admin.page.waitForURL(/\/admin/, { timeout: 20000 });
await admin.page.waitForTimeout(2000);
console.log('admin users rows:', await admin.page.locator('table tbody tr').count());
await admin.page.getByTestId('nav-audit').click();
await admin.page.waitForTimeout(2000);
console.log('audit rows:', await admin.page.locator('table tbody tr').count());
await admin.context.close();

const staff = await newSession('staff@seed.local');
await staff.page.waitForURL(/\/agenda/, { timeout: 20000 });
await staff.page.waitForTimeout(2000);
console.log('staff agenda items:', await staff.page.getByTestId('appointment-item').count());
await staff.page.getByTestId('nav-search').click();
await staff.page.getByTestId('search-submit').click();
await staff.page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
console.log('staff slots:', await staff.page.getByTestId('slot-item').count(), 'book:', await staff.page.getByTestId('book-submit').count());
await staff.context.close();

await browser.close();
