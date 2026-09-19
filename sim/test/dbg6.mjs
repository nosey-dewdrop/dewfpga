import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => /combinational|simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
await page.selectOption('#examples', 'count on the display');
for (let i = 0; i < 6; i++) { await page.waitForTimeout(1000); console.log(i, await page.locator('#status').innerText(), '|', (await page.locator('#console').innerText()).split('\n')[0]); }
await browser.close();
