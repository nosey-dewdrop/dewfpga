import { chromium } from 'playwright';
const S = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
for (const [w, name] of [[900, 'tablet'], [420, 'phone']]) {
  const page = await browser.newPage({ viewport: { width: w, height: 1000 } });
  await page.goto('http://localhost:4173/');
  await page.waitForFunction(() => /combinational|simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
  await page.screenshot({ path: `${S}/w-${name}-index.png` });
  await page.goto('http://localhost:4173/tb.html');
  await page.waitForFunction(() => /compile \d+ ms/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  await page.screenshot({ path: `${S}/w-${name}-tb.png`, fullPage: true });
  await page.close();
}
await browser.close();
