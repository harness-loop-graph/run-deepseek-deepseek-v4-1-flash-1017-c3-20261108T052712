// Temporary smoke check #6: professional agenda window. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console]', message.text());
});
await page.goto('http://localhost:8080/login');
await page.getByTestId('login-email').fill('gomez@seed.local');
await page.getByTestId('login-password').fill('Seed!Passw0rd');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/agenda/, { timeout: 20000 });
await page.waitForTimeout(3000);
console.log('url', page.url());
const ids = await page
  .locator('[data-testid="appointment-item"]')
  .evaluateAll((n) => n.map((x) => x.getAttribute('data-appointment-id')));
console.log('agenda ids', ids.join(','));
console.log('from/to', await page.locator('input[name="from"]').inputValue(), await page.locator('input[name="to"]').inputValue());
console.log('body', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 500));
await context.close();
await browser.close();
