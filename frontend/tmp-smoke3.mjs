// Temporary smoke check #3: full flow across roles. Deleted after use.
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
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  return { context, page };
}

// 1. Wrong password keeps the user on the SPA with an error banner.
{
  const { context, page } = await newSession('paciente2@seed.local', 'wrong-password');
  await page.waitForTimeout(2500);
  console.log('bad login url:', page.url());
  console.log('bad login banners:', await page.getByTestId('error-banner').allInnerTexts());
  await context.close();
}

// 2. Patient books a slot, then the professional records the encounter.
{
  const { context, page } = await newSession('paciente2@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-submit').click();
  await page.getByTestId('slot-item').nth(3).waitFor({ timeout: 20000 });
  const slotStart = await page.getByTestId('slot-item').nth(3).getAttribute('data-slot-start');
  await page.getByTestId('slot-item').nth(3).click();
  await page.getByTestId('book-submit').click();
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('appointment-item').first().waitFor();
  const appointmentId = await page.getByTestId('appointment-item').first().getAttribute('data-appointment-id');
  console.log('patient booked slot', slotStart, 'appointment', appointmentId);
  await context.close();

  const pro = await newSession('gomez@seed.local');
  await pro.page.waitForURL(/\/agenda/, { timeout: 20000 });
  await pro.page.getByTestId('appointment-item').first().waitFor({ timeout: 20000 });
  await pro.page.locator(`[data-testid="appointment-item"][data-appointment-id="${appointmentId}"]`).click();
  await pro.page.getByTestId('encounter-notes').fill('Persistent cough for 5 days. <script>alert(1)</script>');
  await pro.page.getByTestId('encounter-diagnosis').fill('Acute bronchitis');
  await pro.page.getByTestId('encounter-submit').click();
  await pro.page.locator('.encounter-card').first().waitFor({ timeout: 20000 });
  console.log('encounter cards:', await pro.page.locator('.encounter-card').count());
  await pro.page.getByTestId('nav-history').click();
  await pro.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
  console.log('pro history:', (await pro.page.getByTestId('history-timeline').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  await pro.context.close();

  const back = await newSession('paciente2@seed.local');
  await back.page.waitForURL(/\/appointments/, { timeout: 20000 });
  await back.page.getByTestId('nav-history').click();
  await back.page.getByTestId('history-timeline').waitFor({ timeout: 20000 });
  console.log('patient history:', (await back.page.getByTestId('history-timeline').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  console.log('scripts injected:', await back.page.locator('script:has-text("alert(1)")').count());
  await back.context.close();
}

// 3. Staff and admin navigation.
for (const email of ['staff@seed.local', 'admin@seed.local']) {
  const { context, page } = await newSession(email);
  await page.waitForURL(/\/agenda|\/admin/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')),
  );
  console.log(email, '->', new URL(page.url()).pathname, navs.join(','));
  console.log('  states:', await page.locator('[data-testid="error-banner"], [data-testid="empty-state"], [data-testid="loading-indicator"]').count());
  if (email.startsWith('admin')) {
    await page.getByTestId('nav-audit').click();
    await page.waitForTimeout(2000);
    console.log('  audit rows:', await page.locator('table tbody tr').count());
  }
  await context.close();
}

// 4. Anonymous deep link redirects to the login screen.
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:8080/agenda');
  await page.getByTestId('login-email').waitFor({ timeout: 10000 });
  console.log('anonymous /agenda ->', new URL(page.url()).pathname);
  await context.close();
}

await browser.close();
