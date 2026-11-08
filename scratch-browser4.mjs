import { chromium } from '/home/andres/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  executablePath:
    '/home/andres/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
});

for (const email of ['staff@seed.local', 'admin@seed.local']) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:8080/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('Seed!Passw0rd');
  await page.getByTestId('login-submit').click();
  await page.waitForTimeout(4000);
  const navs = await page.locator('[data-testid^="nav-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  console.log(email, new URL(page.url()).pathname, navs.join(','));
  await context.close();
}
await browser.close();
