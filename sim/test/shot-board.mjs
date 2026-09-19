import { chromium } from 'playwright';
const S = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => /combinational|simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
await page.selectOption('#examples', 'count on the display');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
const btn = page.locator('#board .b-btn[data-btn=btnC]');
for (let i = 0; i < 5; i++) { await btn.dispatchEvent('pointerdown'); await page.waitForTimeout(80); await btn.dispatchEvent('pointerup'); await page.waitForTimeout(80); }
await page.locator('#board .b-sw').nth(2).click(); await page.locator('#board .b-sw').nth(9).click();
await page.waitForTimeout(600);
await page.locator('#board').screenshot({ path: S + '/s-board2.png' });
await page.screenshot({ path: S + '/s-page2.png' });
await browser.close();
