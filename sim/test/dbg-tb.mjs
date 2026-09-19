import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto('http://localhost:4173/tb.html');
await page.waitForFunction(() => /compile \d+ ms|failed|stopped/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
await page.selectOption('#examples', 'tb: traffic light fsm');
for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); const s = await page.locator('#status').innerText(); if (/compile \d+ ms|failed|stopped/.test(s)) { console.log('status:', s); break; } }
console.log((await page.locator('#out').innerText()).split('\n').slice(0, 8).join('\n'));
await browser.close();
