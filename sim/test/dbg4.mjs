import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => /combinational|simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
await page.selectOption('#examples', 'count on the display');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#pause');
const r = await page.evaluate(() => {
  const sim = window.cs223.sim;
  const els = sim.circuit._graph.getElements();
  const mem = els.find(e => e.get('type') === 'Memory');
  const io = () => ({ in: Object.fromEntries(Object.entries(mem.get('inputSignals')).map(([k, v]) => [k, v.toBin()])), out: Object.fromEntries(Object.entries(mem.get('outputSignals')).map(([k, v]) => [k, v.toBin()])), seg: [0,1,2,3,4,5,6].map(k => sim.outBit('seg', k)).join('') });
  const out = [{ rdports: mem.get('rdports'), wrports: mem.get('wrports'), abits: mem.get('abits'), bits: mem.get('bits'), words: mem.get('words'), memdata: (mem.get('memdata') || []).slice(0, 4) }];
  out.push({ t: 'start', ...io() });
  sim.setBit('btnC', 0, 1); sim.cycle('clk'); sim.setBit('btnC', 0, 0); sim.cycle('clk');
  for (let i = 0; i < 4; i++) { sim.cycle('clk'); out.push({ t: 'cyc' + i, ...io() }); }
  return out;
});
for (const l of r) console.log(JSON.stringify(l));
await browser.close();
