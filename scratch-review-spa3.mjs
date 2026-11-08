import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const exe = '/home/andres/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
await page.goto('http://localhost:8080/');
await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 });
await page.fill('[data-testid="login-email"]', 'paciente3@seed.local');
await page.fill('[data-testid="login-password"]', 'Seed!Passw0rd');
await page.click('[data-testid="login-submit"]');
await page.waitForTimeout(3500);
await page.click('[data-testid="nav-search"]');
await page.waitForSelector('[data-testid="search-professional"]', { timeout: 15000 });
await page.selectOption('[data-testid="search-professional"]', '1');
await page.fill('[data-testid="search-from"]', '2026-11-17');
await page.fill('[data-testid="search-to"]', '2026-11-18');
await page.click('[data-testid="search-submit"]');
await page.waitForTimeout(3000);
const slots = await page.$$eval('[data-testid="slot-item"]', (e) => e.map((x) => x.getAttribute('data-slot-start')));
console.log('slots', slots.length, slots.slice(0, 3));
if (slots.length > 0) {
  await page.click('[data-testid="slot-item"]');
  await page.click('[data-testid="book-submit"]');
  await page.waitForTimeout(3000);
  console.log('after book', ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 400));
}
await page.goto('http://localhost:8080/appointments');
await page.waitForTimeout(2500);
const ids = await page.$$eval('[data-testid="appointment-item"]', (e) => e.map((x) => x.getAttribute('data-appointment-id')));
console.log('appointments', JSON.stringify(ids));
const cancel = await page.$('[data-testid="cancel-appointment"]');
if (cancel) {
  await cancel.click();
  await page.waitForTimeout(2500);
  console.log('after cancel', ((await page.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 200));
}
await browser.close();
