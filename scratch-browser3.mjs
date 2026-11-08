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
  const { context, page } = await login('paciente2@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('nav-search').click();
  await page.waitForTimeout(1500);
  const sel = page.getByTestId('search-professional');
  console.log('select count', await sel.count());
  const opts = await sel.locator('option').evaluateAll((n) => n.map((o) => `${o.textContent}|${o.value}`));
  console.log('options:', JSON.stringify(opts));
  await page.getByTestId('search-from').fill('2026-11-19');
  await page.getByTestId('search-to').fill('2026-11-19');
  await page.getByTestId('search-submit').click();
  await page.getByTestId('slot-item').first().waitFor({ timeout: 20000 });
  await page.getByTestId('slot-item').first().click();
  await page.getByTestId('book-submit').click();
  await page.waitForTimeout(2500);
  console.log('after book', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 150));
  await context.close();
}

{
  const { context, page } = await login('gomez@seed.local');
  await page.waitForURL(/\/agenda/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  const items = page.getByTestId('appointment-item');
  const n = await items.count();
  let clicked = false;
  for (let i = 0; i < n; i += 1) {
    const text = await items.nth(i).innerText();
    if (!text.includes('CANCELLED')) {
      await items.nth(i).click();
      clicked = true;
      break;
    }
  }
  console.log('clicked scheduled', clicked);
  await page.waitForTimeout(2500);
  console.log('url', new URL(page.url()).pathname, 'notes form', await page.getByTestId('encounter-notes').count());
  if (await page.getByTestId('encounter-notes').count()) {
    await page.getByTestId('encounter-notes').fill('Sore throat and fever');
    await page.getByTestId('encounter-diagnosis').fill('Pharyngitis');
    await page.getByTestId('encounter-submit').click();
    await page.waitForTimeout(3000);
    console.log('after submit', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 250));
  }
  await context.close();
}

{
  const { context, page } = await login('paciente2@seed.local');
  await page.waitForURL(/\/appointments/, { timeout: 20000 });
  await page.getByTestId('nav-history').click();
  await page.waitForTimeout(2500);
  const t = await page.getByTestId('history-timeline').innerText();
  console.log('timeline:', t.replace(/\n+/g, ' | ').slice(0, 250));
  await context.close();
}

{
  const { context, page } = await login('admin@seed.local');
  await page.waitForURL(/\/admin/, { timeout: 20000 });
  await page.waitForTimeout(2500);
  console.log('admin body', (await page.locator('main').innerText()).replace(/\n+/g, ' | ').slice(0, 300));
  await page.getByTestId('nav-audit').click();
  await page.waitForTimeout(2500);
  console.log('audit rows', await page.locator('tbody tr').count());
  await context.close();
}

await browser.close();
