// Temporary smoke check #4: professional history screen. Deleted after use.
import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('[pageerror]', error.message));
page.on('console', (message) => console.log('[console]', message.type(), message.text()));
page.on('response', (response) => {
  if (response.url().includes(':3000')) {
    console.log('[api]', response.status(), response.request().method(), response.url());
  }
});

await page.goto('http://localhost:8080/login');
await page.getByTestId('login-email').fill('gomez@seed.local');
await page.getByTestId('login-password').fill('Seed!Passw0rd');
await page.getByTestId('login-submit').click();
await page.waitForURL(/\/agenda/, { timeout: 20000 });
await page.getByTestId('nav-history').click();
await page.waitForTimeout(4000);
console.log('url', page.url());
console.log('body', (await page.locator('body').innerText()).slice(0, 1200));
await browser.close();
