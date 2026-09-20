import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const [,, out, ...pages] = process.argv;
const ctx = await b.newContext({ viewport:{width:1366,height:768} });
for (const p of pages) { const pg = await ctx.newPage(); await pg.goto('http://127.0.0.1:4311/dewfpga/'+p,{waitUntil:'networkidle'}); await pg.waitForTimeout(p.startsWith('sim')?4000:600);
  await pg.screenshot({ path:`${out}/desk-${(p||'index').replace(/[\/?=]+/g,'_').replace(/_$/,'')}.png` }); await pg.close(); }
await b.close();
