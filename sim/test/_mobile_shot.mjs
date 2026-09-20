import { chromium } from 'playwright';
const [,, outDir, ...pagesArg] = process.argv;
const BASE = 'http://127.0.0.1:4311/dewfpga/';
const pages = pagesArg.length ? pagesArg : ['', 'why/', 'cli/', 'docs/', 'errors/', 'errors/no-chipdb/', 'errors/missing-separator/', '404.html', 'tr/', 'sim/', 'sim/?view=tb'];
const sizes = [[390,844],[430,932]];
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
for (const [w,h] of sizes) {
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  for (const p of pages) {
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(e=>console.log('nav fail',p,e.message));
    await page.waitForTimeout(p.startsWith('sim') ? 4000 : 800);
    const r = await page.evaluate((vw) => {
      const de = document.documentElement;
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        const b = el.getBoundingClientRect();
        if (b.right > vw + 1 || b.left < -1) {
          const id = el.tagName.toLowerCase() + (el.id?'#'+el.id:'') + (el.className && typeof el.className==='string' ? '.'+el.className.trim().split(/\s+/).join('.') : '');
          wide.push(`${id} L${Math.round(b.left)} R${Math.round(b.right)}`);
        }
      }
      const small = [];
      for (const el of document.querySelectorAll('a,button,select,input,[role=tab]')) {
        const b = el.getBoundingClientRect(); if (!b.width && !b.height) continue;
        if (b.height < 44 || b.width < 44) small.push(`${el.tagName.toLowerCase()}${el.id?'#'+el.id:''} "${(el.textContent||'').trim().slice(0,18)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      return { sw: de.scrollWidth, cw: de.clientWidth, bodySW: document.body.scrollWidth, wide: wide.slice(0,12), nwide: wide.length, small: small.slice(0,40), nsmall: small.length };
    }, w);
    const name = (p || 'index').replace(/[\/?=]+/g,'_').replace(/_$/,'') ;
    await page.screenshot({ path: `${outDir}/${name}-${w}.png`, fullPage: true });
    console.log(`\n== ${p||'/'} @${w}: scrollWidth ${r.sw} (viewport ${r.cw}) ${r.sw>r.cw?'OVERFLOW':'ok'}; ${r.nwide} wide elems; ${r.nsmall} small targets`);
    for (const x of r.wide) console.log('   wide:', x);
    for (const x of r.small) console.log('   small:', x);
    await page.close();
  }
  await ctx.close();
}
await browser.close();
