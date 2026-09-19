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
  const sig = (label) => { const c = els.find(e => ((e.get('label') || '') + (e.get('net') || '')).includes(label)); if (!c) return 'nocell'; const o = c.get('outputSignals') || {}; return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toBin()])); };
  const snap = (t) => ({ t, btnC: sig('btnC'), not: sig('logic_not'), and: sig('logic_and'), dff30: sig('procdff$30'), dff29: sig('procdff$29'), mux26: sig('procmux$26'), mux23: sig('procmux$23'), add: sig('add$design.sv:15') });
  const out = [snap('start')];
  sim.setBit('btnC', 0, 1); sim.settle(); out.push(snap('btnC=1 settled'));
  sim.cycle('clk'); out.push(snap('cycle1'));
  sim.cycle('clk'); out.push(snap('cycle2'));
  sim.setBit('btnC', 0, 0); sim.settle(); sim.cycle('clk'); out.push(snap('btnC=0 cycle3'));
  // clock polarity attributes on the dff
  const d = els.find(e => (e.get('label') || '').includes('procdff$29'));
  out.push({ dffattrs: JSON.stringify({ polarity: d.get('polarity'), bits: d.get('bits'), in: Object.keys(d.get('inputSignals') || {}), inputSignals: Object.fromEntries(Object.entries(d.get('inputSignals')).map(([k, v]) => [k, v.toBin()])) }) });
  return out;
});
for (const l of r) console.log(JSON.stringify(l));
await browser.close();
