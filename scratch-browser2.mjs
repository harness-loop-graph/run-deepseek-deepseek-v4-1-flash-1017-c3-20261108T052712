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
  const { context, page } = await login('paciente1@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('nav-search').click();
  const opts = await page.getByTestId('search-professional').locator('option').evaluateAll((n) => n.map((o) => `${o.textContent}|${o.value}`));
  console.log('select options', opts.join(' ; '));
  await page.getByTestId('search-from').fill('2026-11-18');
  await page.getByTestId('search-to').fill('2026-11-18');
  await page.getByTestId('search-submit').click();
  await page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
  console.log('slots', await page.getByTestId('slot-item').count(), await page.getByTestId('slot-item').first().getAttribute('data-slot-start'));
  await page.getByTestId('slot-item').first().click();
  await page.getByTestId('book-submit').click();
  await page.waitForTimeout(2500);
  await page.getByTestId('nav-bookings').click();
  await page.waitForTimeout(1500);
  console.log('appointment items', await page.getByTestId('appointment-item').count());
  await context.close();
}

{
  const { context, page } = await login('gomez@seed.local');
  await page.waitForURL(/\/agenda/, { timeout: 20000 });
  await page.waitForTimeout(2000);
  await page.getByTestId('appointment-item').first().click();
  await page.waitForTimeout(2000);
  console.log('detail url', new URL(page.url()).pathname);
  const notes = page.getByTestId('encounter-notes');
  if (await notes.count()) {
    await notes.fill('Back pain for one week');
    await page.getByTestId('encounter-diagnosis').fill('Lumbar strain');
    await page.getByTestId('encounter-submit').click();
    await page.waitForTimeout(2500);
    console.log('after submit', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 200));
  } else {
    console.log('no encounter form', (await page.locator('main').innerText()).slice(0, 200));
  }
  await context.close();
}

{
  const { context, page } = await login('paciente1@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('nav-history').click();
  await page.waitForTimeout(2000);
  const timeline = await page.getByTestId('history-timeline').innerText();
  console.log('timeline', timeline.replace(/\n+/g, ' | ').slice(0, 250));
  await context.close();
}

await browser.close();
