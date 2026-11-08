import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const exe = '/home/andres/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

async function login(browser, email) {
  const page = await browser.newPage();
  await page.goto('http://localhost:8080/');
  await page.waitForSelector('[data-testid="login-email"]', { timeout: 15000 });
  await page.fill('[data-testid="login-email"]', email);
  await page.fill('[data-testid="login-password"]', 'Seed!Passw0rd');
  await page.click('[data-testid="login-submit"]');
  await page.waitForTimeout(3500);
  return page;
}

const browser = await chromium.launch({ executablePath: exe });
const pro = await login(browser, 'gomez@seed.local');
await pro.goto('http://localhost:8080/appointments/19');
await pro.waitForTimeout(2500);
console.log('url', pro.url());
console.log('body', ((await pro.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 300));
const notes = await pro.$('[data-testid="encounter-notes"]');
console.log('notes field', notes !== null);
if (notes) {
  await pro.fill('[data-testid="encounter-notes"]', 'Review note text');
  await pro.fill('[data-testid="encounter-diagnosis"]', 'Review diagnosis');
  await pro.click('[data-testid="encounter-submit"]');
  await pro.waitForTimeout(2500);
  console.log('after submit', ((await pro.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 400));
}
await pro.close();

const pat = await login(browser, 'paciente2@seed.local');
await pat.click('[data-testid="nav-search"]');
await pat.waitForSelector('[data-testid="search-professional"]', { timeout: 15000 });
await pat.fill('[data-testid="search-from"]', '2026-11-24');
await pat.fill('[data-testid="search-to"]', '2026-11-25');
await pat.click('[data-testid="search-submit"]');
await pat.waitForTimeout(3000);
console.log('search body', ((await pat.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 300));
const slotCount = await pat.$$eval('[data-testid="slot-item"]', (e) => e.length);
console.log('slots', slotCount);
if (slotCount > 0) {
  await pat.click('[data-testid="slot-item"]');
  await pat.click('[data-testid="book-submit"]');
  await pat.waitForTimeout(2500);
  console.log('after book', ((await pat.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 300));
}
await pat.goto('http://localhost:8080/appointments');
await pat.waitForTimeout(2500);
const cancel = await pat.$('[data-testid="cancel-appointment"]');
console.log('cancel present', cancel !== null);
if (cancel) {
  await cancel.click();
  await pat.waitForTimeout(2500);
  console.log('after cancel', ((await pat.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 250));
}
await pat.click('[data-testid="nav-history"]');
await pat.waitForTimeout(2500);
console.log('history', ((await pat.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 400));
const tl = await pat.$('[data-testid="history-timeline"]');
console.log('timeline', tl !== null);
await pat.close();
await browser.close();
