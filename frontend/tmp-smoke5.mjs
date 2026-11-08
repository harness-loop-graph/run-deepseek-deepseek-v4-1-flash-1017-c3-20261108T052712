// Temporary smoke check #5: staff/admin screens. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

async function login(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('[pageerror]', error.message));
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Seed!Passw0rd');
  await page.getByTestId('login-submit').click();
  return { context, page };
}

{
  const { context, page } = await login('staff@seed.local');
  await page.waitForURL(/\/agenda/, { timeout: 20000 });
  await page.waitForTimeout(2000);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  console.log('staff', new URL(page.url()).pathname, navs.join(','));
  console.log('staff agenda body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-submit').click();
  await page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
  console.log('staff slots:', await page.getByTestId('slot-item').count(), 'book buttons:', await page.getByTestId('book-submit').count());
  await page.screenshot({ path: '/tmp/shot-staff-search.png', fullPage: false });
  await context.close();
}

{
  const { context, page } = await login('admin@seed.local');
  await page.waitForURL(/\/admin/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  console.log('admin', new URL(page.url()).pathname, navs.join(','));
  console.log('admin body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 700));
  await page.screenshot({ path: '/tmp/shot-admin.png', fullPage: true });
  await page.getByTestId('nav-audit').click();
  await page.waitForTimeout(2500);
  console.log('audit rows:', await page.locator('table tbody tr').count());
  console.log('audit first row:', (await page.locator('table tbody tr').first().innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: '/tmp/shot-audit.png', fullPage: true });
  await context.close();
}

{
  const { context, page } = await login('paciente1@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  console.log('patient body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
  await page.getByTestId('nav-history').click();
  await page.waitForTimeout(2000);
  console.log('patient history body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 400));
  await page.screenshot({ path: '/tmp/shot-patient-history.png', fullPage: true });
  await context.close();
}

{
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:8080/agenda');
  await page.getByTestId('login-email').waitFor({ timeout: 10000 });
  console.log('anonymous /agenda ->', new URL(page.url()).pathname);
  await context.close();
}

await browser.close();
