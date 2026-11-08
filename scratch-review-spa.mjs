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

for (const email of ['gomez@seed.local', 'staff@seed.local', 'admin@seed.local']) {
  const page = await login(browser, email);
  const navs = await page.$$eval('[data-testid^="nav-"]', (els) => els.map((e) => e.getAttribute('data-testid')));
  console.log(email, '->', page.url(), JSON.stringify(navs));
  await page.close();
}

// professional: agenda -> open appointment -> record encounter
const pro = await login(browser, 'gomez@seed.local');
await pro.waitForSelector('[data-testid="appointment-item"]', { timeout: 15000 });
const count = await pro.$$eval('[data-testid="appointment-item"]', (e) => e.length);
console.log('agenda items', count);
const hasEncounterForm = await pro.$('[data-testid="encounter-notes"]');
console.log('agenda shows encounter form?', hasEncounterForm !== null);
await pro.click('[data-testid="appointment-item"]');
await pro.waitForTimeout(2500);
console.log('after click url', pro.url());
const notes = await pro.$('[data-testid="encounter-notes"]');
console.log('encounter notes field', notes !== null);
if (notes) {
  await pro.fill('[data-testid="encounter-notes"]', 'Review note text');
  await pro.fill('[data-testid="encounter-diagnosis"]', 'Review diagnosis');
  await pro.click('[data-testid="encounter-submit"]');
  await pro.waitForTimeout(2500);
  const body = await pro.textContent('body');
  console.log('after submit', (body ?? '').replace(/\s+/g, ' ').slice(0, 220));
}
await pro.close();

// patient: search and book, then cancel, then history
const pat = await login(browser, 'paciente2@seed.local');
await pat.click('[data-testid="nav-search"]');
await pat.waitForSelector('[data-testid="search-professional"]', { timeout: 15000 });
const options = await pat.$$eval('[data-testid="search-professional"] option', (els) => els.map((e) => e.textContent + '=' + e.value));
console.log('professionals', JSON.stringify(options));
await pat.fill('[data-testid="search-from"]', '2026-11-24');
await pat.fill('[data-testid="search-to"]', '2026-11-25');
await pat.click('[data-testid="search-submit"]');
await pat.waitForSelector('[data-testid="slot-item"]', { timeout: 15000 });
const slotStart = await pat.$eval('[data-testid="slot-item"]', (e) => e.getAttribute('data-slot-start'));
console.log('slot', slotStart);
await pat.click('[data-testid="slot-item"]');
await pat.click('[data-testid="book-submit"]');
await pat.waitForTimeout(2500);
const afterBook = await pat.textContent('body');
console.log('after book', (afterBook ?? '').replace(/\s+/g, ' ').slice(0, 200));
await pat.goto('http://localhost:8080/appointments');
await pat.waitForSelector('[data-testid="appointment-item"]', { timeout: 15000 });
const cancel = await pat.$('[data-testid="cancel-appointment"]');
console.log('cancel button present', cancel !== null);
if (cancel) {
  await cancel.click();
  await pat.waitForTimeout(2000);
  console.log('after cancel', (await pat.textContent('body')).replace(/\s+/g, ' ').slice(0, 160));
}
await pat.click('[data-testid="nav-history"]');
await pat.waitForTimeout(2500);
const timeline = await pat.$('[data-testid="history-timeline"]');
console.log('history timeline', timeline !== null, ((await pat.textContent('body')) ?? '').replace(/\s+/g, ' ').slice(0, 200));
await pat.close();

await browser.close();
