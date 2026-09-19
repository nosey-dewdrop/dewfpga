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
  const cells = els.filter(e => ['Mux1Hot','Eq','NorReduce','Dff','BusSlice','BusGroup'].includes(e.get('type')));
  const dump = () => cells.map(c => `${c.get('type')}:${(c.get('label')||'').slice(-12)} in=${JSON.stringify(Object.fromEntries(Object.entries(c.get('inputSignals')||{}).map(([k,v])=>[k,v.toBin()])))} out=${JSON.stringify(Object.fromEntries(Object.entries(c.get('outputSignals')||{}).map(([k,v])=>[k,v.toBin()])))}`);
  const out = [];
  sim.setBit('btnC', 0, 1); sim.cycle('clk'); sim.setBit('btnC', 0, 0); sim.cycle('clk');
  for (let i = 0; i < 2; i++) { sim.cycle('clk'); out.push('--- cycle ' + i); out.push(...dump()); }
  const m = els.find(e => e.get('type') === 'Mux1Hot');
  out.push('mux1hot attrs: ' + JSON.stringify({ bits: m.get('bits') }));
  const links = sim.circuit._graph.getLinks().filter(l => l.get('target').id === m.id).map(l => `${(els.find(e=>e.id===l.get('source').id)||{get:()=>'?'}).get('type')}.${l.get('source').port} -> ${l.get('target').port}`);
  out.push(...links);
  return out;
});
console.log(r.join('\n'));
await browser.close();
