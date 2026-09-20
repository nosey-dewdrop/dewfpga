import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const ctx = await b.newContext({ viewport:{width:390,height:844}, isMobile:true });
for (const p of process.argv.slice(2)) {
  const pg = await ctx.newPage(); await pg.goto('http://127.0.0.1:4311/dewfpga/'+p,{waitUntil:'networkidle'}); await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const out=[]; const vw=document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const b=el.getBoundingClientRect(); if (b.right<=vw+1) continue;
      let a=el.parentElement, clipped=false; while(a){ const o=getComputedStyle(a).overflowX; if(o==='auto'||o==='scroll'||o==='hidden'){clipped=true;break;} a=a.parentElement; }
      if(!clipped) out.push(el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):'')+' R'+Math.round(b.right)+' text='+(el.textContent||'').trim().slice(0,40).replace(/\n/g,' '));
    }
    return out.slice(0,15);
  });
  console.log('==',p); r.forEach(x=>console.log('  ',x)); await pg.close();
}
await b.close();
