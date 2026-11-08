import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

async function login(email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Seed!Passw0rd');
  await page.getByTestId('login-submit').click();
  return { context, page };
}

{
  const { context, page } = await login('paciente3@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  console.log('patient url', new URL(page.url()).pathname, 'navs', navs.join(','));
  console.log('items', await page.getByTestId('appointment-item').count());
  await page.getByTestId('nav-search').click();
  await page.getByTestId('search-submit').click();
  await page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
  const slots = await page.getByTestId('slot-item').count();
  console.log('slots', slots);
  await page.getByTestId('slot-item').first().click();
  await page.getByTestId('book-submit').click();
  await page.waitForTimeout(2500);
  console.log('after book body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 250));
  await page.getByTestId('nav-history').click();
  await page.waitForTimeout(2000);
  console.log('history body:', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  await context.close();
}

{
  const { context, page } = await login('gomez@seed.local');
  await page.waitForURL(/\/agenda/, { timeout: 20000 });
  await page.waitForTimeout(2000);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  console.log('pro navs', navs.join(','), 'agenda items', await page.getByTestId('appointment-item').count());
  await context.close();
}

await browser.close();
