import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage();
page.on('console', (m) => console.log('[browser]', m.text()));
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => /combinational|simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 180000 });
await page.selectOption('#examples', 'count on the display');
await page.waitForFunction(() => /simulated clock/.test(document.querySelector('#status').textContent), null, { timeout: 60000 });
await page.click('#pause');
const r = await page.evaluate(() => {
  const sim = window.cs223.sim;
  const seg = () => { let m = 0; for (let k = 0; k < 7; k++) if (sim.outBit('seg', k) === -1) m |= 1 << k; return m.toString(2).padStart(7, '0'); };
  const an = () => [0,1,2,3].map(i => sim.outBit('an', i)).join(',');
  const out = [];
  out.push(['inputs', [...sim.inputs.keys()], 'values', JSON.stringify([...sim.values])]);
  for (let p = 0; p < 3; p++) {
    sim.setBit('btnC', 0, 1); for (let i = 0; i < 4; i++) sim.cycle('clk');
    sim.setBit('btnC', 0, 0); for (let i = 0; i < 4; i++) sim.cycle('clk');
  }
  for (let i = 0; i < 4; i++) { sim.cycle('clk'); out.push(['an', an(), 'seg', seg()]); }
  // inspect internal dff cells
  const cells = sim.circuit._graph.getElements().map(c => [c.get('type'), c.get('label') || c.get('net') || '', c.get('bits')]);
  out.push(['cells', JSON.stringify(cells)]);
  return out;
});
for (const l of r) console.log(...l);
await browser.close();
