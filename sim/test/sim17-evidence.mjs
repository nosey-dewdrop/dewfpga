// Original five simulator regressions, asserted at the actual browser/UI boundary.
// Run through npm test, or BASE=<preview> BROWSER=chromium|webkit node test/sim17-evidence.mjs.
import { chromium, webkit, firefox } from 'playwright';
import assert from 'node:assert/strict';
const browserName = process.env.BROWSER || 'chromium';
const type = { chromium, webkit, firefox }[browserName];
assert.ok(type, `supported BROWSER=${browserName}`);
const launch = { headless: !process.env.E2E_HEADED };
if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
const browser = await type.launch(launch);
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(process.env.BASE || 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.dewfpga?.sim, null, { timeout:120000 });
  const idle = () => page.waitForFunction(() => window.dewfpga.pendingRequests === 0 && !window.dewfpga.lint.pending, null, { timeout:120000 });
  const editRun = text => page.evaluate(text => {
    window.dewfpga.files.set('design.sv', text);
    document.querySelector('#run').click();
  }, text);
  const clickLine = async line => {
    await page.click('.ftab[data-tab="basys3.xdc"]');
    await page.locator(`#console .c-link[data-file="design.sv"][data-line="${line}"]`).first().click();
    const at = await page.evaluate(() => {
      const f = window.dewfpga.files, view = f.get(f.active).view;
      return { file:f.active, line:view.state.doc.lineAt(view.state.selection.main.head).number };
    });
    assert.deepEqual(at, { file:'design.sv', line });
  };
  // An existing live output must be cleared when a new compilation fails.
  await page.locator('#board .b-sw').nth(0).click();
  await page.waitForFunction(() => document.querySelectorAll('#board .b-led.on').length > 0);
  await editRun('module top(input [15:0] sw, output [15:0] led);\nassign led = sw +;\nendmodule');
  await idle();
  await clickLine(2);
  console.log('PASS #17 Yosys source link selects the exact file and line');
  assert.equal(await page.evaluate(() => window.dewfpga.sim), null);
  assert.equal(await page.locator('.b-pwrled.on').count(), 1);
  assert.equal(await page.locator('.b-doneled.on, #board .b-led.on, #board .b-led.x').count(), 0);
  console.log('PASS #17 failed compilation clears old outputs and DONE, preserves POWER');
  await editRun('module top(input clk, input [15:0] sw, output [15:0] led);\nalways @(posedge clk) $display("tick");\nassign led = sw;\nendmodule');
  await idle();
  assert.equal(await page.evaluate(() => window.dewfpga.sim?.top), 'top', await page.locator('#console').innerText());
  assert.match(await page.locator('#console').innerText(), /\$display.*dropped/);
  assert.equal(await page.locator('.b-doneled.on').count(), 1);
  console.log('PASS #17 synthesizable $display is dropped with an explanation, circuit runs');
  await editRun('module top(input [15:0] sw, output [15:0] led);\n// deliberately missing submodule\nmissing_part u(.a(sw), .b(led));\nendmodule');
  await idle();
  assert.equal(await page.evaluate(() => window.dewfpga.sim), null);
  assert.match(await page.locator('#console').innerText(), /missing_part/);
  await clickLine(3);
  console.log('PASS #17 missing module diagnostic points to its actual instance line');
  const saved = 'module top(input [15:0] sw, output [15:0] led); assign led = ~sw; endmodule // autosave regression';
  await page.evaluate(text => window.dewfpga.files.set('design.sv', text), saved);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dewfpga.workspace'))?.files.some(f => f.path === 'design.sv' && f.text.includes('autosave regression')));
  await page.reload();
  await page.waitForFunction(() => window.dewfpga?.files.text('design.sv').includes('autosave regression'));
  assert.equal(await page.evaluate(() => window.dewfpga.files.text('design.sv')), saved);
  console.log('PASS #17 an edit without Run survives a browser reload');
  assert.deepEqual(errors, []);
  console.log(`sim17-regressions: 5 passed, 0 failed; browser ${browserName}; no page errors`);
} finally { await browser.close(); }
