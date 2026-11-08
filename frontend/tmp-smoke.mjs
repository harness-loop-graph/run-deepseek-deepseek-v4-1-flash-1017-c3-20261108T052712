// Temporary smoke check of the SPA against the running stack. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (message) => console.log('[console]', message.type(), message.text()));
page.on('pageerror', (error) => console.log('[pageerror]', error.message));

async function login(email) {
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').waitFor();
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Seed!Passw0rd');
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/appointments|\/agenda|\/admin/, { timeout: 15000 });
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid')),
  );
  console.log(email, '->', new URL(page.url()).pathname, navs.join(','));
}

await login('paciente1@seed.local');
await page.getByTestId('nav-search').click();
await page.getByTestId('search-submit').click();
await page.getByTestId('slot-item').first().waitFor({ timeout: 15000 });
await page.getByTestId('slot-item').first().click();
await page.getByTestId('book-submit').click();
await page.waitForURL(/\/appointments/, { timeout: 15000 });
await page.getByTestId('appointment-item').first().waitFor();
console.log('booked ok, items:', await page.getByTestId('appointment-item').count());
await page.getByTestId('cancel-appointment').first().click();
await page.waitForTimeout(1000);
console.log('after cancel, status text:', (await page.getByTestId('appointment-item').first().innerText()).replace(/\n/g, ' | '));

await context.clearCookies();
await page.evaluate(() => sessionStorage.clear());
await login('gomez@seed.local');
await page.getByTestId('appointment-item').first().click();
await page.getByTestId('encounter-notes').fill('Smoke notes <b>not html</b>');
await page.getByTestId('encounter-diagnosis').fill('Smoke diagnosis');
await page.getByTestId('encounter-submit').click();
await page.waitForTimeout(1500);
console.log('encounter saved:', await page.locator('.encounter-card').count());

await page.getByTestId('nav-history').click();
await page.getByTestId('history-timeline').waitFor({ timeout: 15000 });
console.log('history:', (await page.getByTestId('history-timeline').innerText()).slice(0, 160).replace(/\n/g, ' | '));

await browser.close();
