import { nestedProject } from './fixtures/nested-project.mjs';
// one workspace, two views. run: npm test (builds, serves dist on a free localhost port, runs this file, stops the server).
// by hand: BASE=http://127.0.0.1:4173/ node test/e2e.mjs against a running `npm run preview`.
//   BROWSER=chromium|webkit|firefox   playwright's installed browser (npx playwright install <name>); default chromium
//   E2E_EXECUTABLE=/path/to/browser   explicit executable override (a locally cached browser); nothing is hardcoded
//   E2E_OUT=dir                       screenshots (e2e-*.png); default $TMPDIR/dewfpga-e2e
import { chromium, webkit, firefox } from 'playwright';
import lz from 'lz-string';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const S = process.env.E2E_OUT || process.env.SHOTS || path.join(os.tmpdir(), 'dewfpga-e2e');
fs.mkdirSync(S, { recursive: true });
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const browsers = { chromium, webkit, firefox };
const browserName = process.env.BROWSER || 'chromium';
if (!browsers[browserName]) { console.error(`BROWSER=${browserName}: use chromium, webkit or firefox`); process.exit(2); }
const launch = { headless: !process.env.E2E_HEADED };
if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
const browser = await browsers[browserName].launch(launch);
console.log(`browser ${browserName} ${browser.version()}  base ${BASE}  out ${S}`);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}  ${detail}`); } };
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.type() + ': ' + m.text()); });
const status = () => page.locator('#status').innerText();
const waitStatus = (re, t = 180000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status').textContent), re.source, { timeout: t });
const ledClass = (i) => page.locator('#board .b-led').nth(i).getAttribute('class');
const typeInto = async (tab, text) => { await page.click(`.ftab[data-tab="${tab}"]`); await page.locator('#editors .editor:not([hidden]) .cm-content').click(); await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.type(text); };

try {
console.log('== boot: the default project is the cli template (blink)');
await page.goto(BASE);
await waitStatus(/simulated clock|combinational|error|not running/);
check('board view first', await page.locator('#view-board').getAttribute('class') === 'on');
check('tabs are design.sv, tb.sv, basys3.xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(',') === 'design.sv,tb.sv,basys3.xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(','));
check('design.sv is templates/blink.sv', (await page.evaluate(() => window.dewfpga.files.text('design.sv'))).includes('module blink'));
check('tb.sv is templates/blink_tb.sv', (await page.evaluate(() => window.dewfpga.files.text('tb.sv'))).includes('module blink_tb'));
check('xdc is templates/blink.xdc (33 pins)', (await page.evaluate(() => window.dewfpga.files.text('basys3.xdc'))).split('\n').filter((l) => /^set_property/.test(l)).length === 33);
check('console says ok, top blink', (await page.locator('#console').innerText()).startsWith('ok · top blink'), (await page.locator('#console').innerText()).split('\n')[0]);
check('clock is running', /simulated clock/.test(await status()), await status());

console.log('== board: sw0 gates led15 and led0 blinks');
check('led15 off with sw0 off', !(await ledClass(15)).includes('on'));
await page.locator('#board .b-sw').nth(0).click(); await page.waitForTimeout(150);
check('led15 on with sw0 on', (await ledClass(15)).includes('on'));
const seen = new Set(); for (let i = 0; i < 25; i++) { seen.add(await ledClass(0)); await page.waitForTimeout(60); }
check('led0 toggles over 1.5 s', seen.size === 2, [...seen].join(' | '));
await page.screenshot({ path: S + '/e2e-board.png' });

console.log('== testbench view: the same files, icarus verilog');
await page.click('#view-tb');
await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
check('tb view on', await page.locator('#view-tb').getAttribute('class') === 'on');
check('board hidden', await page.locator('#board-view').isHidden());
const out = await page.locator('#out').innerText();
check('blink_tb prints PASS: 3 checks', out.includes('PASS: 3 checks'), out.split('\n').slice(0, 3).join(' | '));
check('waveform has rows', (await page.locator('#wave').evaluate((c) => c.height)) > 50, String(await page.locator('#wave').evaluate((c) => c.height)));
check('status has signals', /signals/.test(await status()), await status());
check('console label iverilog', (await page.locator('#console-label').innerText()) === 'iverilog');
check('url has view=tb', page.url().includes('view=tb'));
await page.screenshot({ path: S + '/e2e-tb.png' });

console.log('== edit the design in tb view, the change reaches both tools');
await typeInto('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = {sw[0], 14\'b0, 1\'b1}; endmodule');
await page.click('#run');
await waitStatus(/compile \d+ ms/, 60000);
await page.waitForTimeout(200);
check('tb sees the edited design and reports $error as a failed run', (await page.locator('#out').innerText()).includes('led[0] must be 0') && /run failed/.test(await status()), (await page.locator('#out').innerText()).split('\n').slice(0, 3).join(' | '));
await page.click('#view-board');
await waitStatus(/simulated clock/, 60000);
await page.waitForTimeout(200);
check('board sees the edited design (led0 solid on)', (await ledClass(0)).includes('on'));

console.log('== examples carry all three files');
await page.selectOption('#examples', 'count on the display');
await waitStatus(/simulated clock/, 60000);
const btn = page.locator('#board .b-btn[data-btn=btnC]');
for (let i = 0; i < 3; i++) { await btn.dispatchEvent('pointerdown'); await page.waitForTimeout(80); await btn.dispatchEvent('pointerup'); await page.waitForTimeout(80); }
await page.waitForTimeout(300);
const digits = await page.evaluate(() => [...document.querySelectorAll('#board g[transform^="translate(150 334)"] > g')].map((d) => [...d.querySelectorAll('.b-seg')].map((s) => s.classList.contains('on') ? 1 : 0).join('')));
check('display shows 3 after three presses', digits.some((d) => d.startsWith('1111001')), digits.join(' '));
await page.click('#view-tb');
await waitStatus(/compile \d+ ms/, 60000);
check('count tb: value after 3 presses = 3', (await page.locator('#out').innerText()).includes('value after 3 presses = 3'), (await page.locator('#out').innerText()).split('\n').slice(0, 3).join(' | '));
await page.selectOption('#examples', 'traffic light fsm');
await waitStatus(/compile \d+ ms/, 60000);
check('traffic tb prints light changes', (await page.locator('#out').innerText()).includes('la='));

console.log('== multi-file design');
await page.click('#view-board');
await waitStatus(/simulated clock|combinational/, 60000);
await page.selectOption('#examples', 'switches to leds');
await waitStatus(/combinational/, 60000);
await typeInto('design.sv', 'module top(input logic [15:0] sw, output logic [15:0] led); inv u(.a(sw), .y(led)); endmodule');
await page.evaluate(() => window.dewfpga.files.add('m2.sv', 'module inv(input logic [15:0] a, output logic [15:0] y); assign y = ~a; endmodule'));
await page.click('#run');
await waitStatus(/combinational/, 60000);
await page.waitForTimeout(200);
check('m2.sv tab sits before tb.sv and the xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(',') === 'design.sv,m2.sv,tb.sv,basys3.xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(','));
check('inverted: led5 on with sw5 off', (await ledClass(5)).includes('on'));
await page.click('#view-tb');
await waitStatus(/compile \d+ ms/, 60000);
check('tb compiles the two-file design (FAIL lines, since inverted)', (await page.locator('#out').innerText()).includes('FAIL'), (await page.locator('#out').innerText()).split('\n')[0]);

console.log('== #20 live diagnostics: typing lints, errors close run, warnings do not');
const lintState = () => page.evaluate(() => { const l = window.dewfpga.lint; return { settled: l.settled, pending: l.pending, hasErrors: l.hasErrors, n: l.diags.length, errors: l.diags.filter((d) => d.kind === 'error').length, warnings: l.diags.filter((d) => d.kind === 'warning').length, generation: l.generation }; });
const waitLint = (t = 90000) => page.waitForFunction(() => { const l = window.dewfpga.lint; return l.settled && !l.pending && window.dewfpga.pendingRequests === 0; }, null, { timeout: t });
const runDisabled = () => page.locator('#run').isDisabled();
const marks = (cls) => page.locator(`#editors .editor:not([hidden]) .${cls}`).count();
await typeInto('tb.sv', 'module tb; initial begin $display("x" endmodule');
check('typing makes the verdict unresolved and leaves run open', !(await runDisabled()) && !(await lintState()).settled, JSON.stringify(await lintState()));
await waitLint();
check('broken tb.sv: lint settles with an error without pressing run', (await lintState()).hasErrors, JSON.stringify(await lintState()));
check('problems panel names tb.sv:line', /tb\.sv:\d+/.test(await page.locator('#problems').innerText()), (await page.locator('#problems').innerText()).split('\n')[0]);
check('problems label counts the error', /problems · 1 error/.test(await page.locator('#problems-label').innerText()), await page.locator('#problems-label').innerText());
check('the broken line carries an error mark', (await marks('cm-diag-error')) >= 1, String(await marks('cm-diag-error')));
check('run is disabled while the error stands', await runDisabled());
check('problems row links to the file and line', await page.locator('#problems .c-link[data-file="tb.sv"]').count() === 1);
const hint = page.locator('#problems .hint').first();
check('each error has a hint button', (await page.locator('#problems .hint').count()) === (await lintState()).errors && (await lintState()).errors >= 1, JSON.stringify(await lintState()));
check('hint is marked non-clickable', (await hint.getAttribute('aria-disabled')) === 'true');
const before20 = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, problems: document.querySelector('#problems').innerText, url: location.href }));
await hint.click({ force: true });
await page.waitForTimeout(150);
const after20 = await page.evaluate(() => ({ status: document.querySelector('#status').textContent, problems: document.querySelector('#problems').innerText, url: location.href }));
check('clicking hint changes nothing', JSON.stringify(before20) === JSON.stringify(after20), JSON.stringify(after20));
await hint.hover(); await page.waitForTimeout(250);
const tip = await hint.evaluate((h) => { const t = h.querySelector('.tip'); return { content: t && t.textContent, opacity: t && getComputedStyle(t).opacity, bracket: getComputedStyle(h, '::after').content }; });
check('hint shows "coming soon!" on hover', tip.content === 'coming soon!' && tip.opacity === '1', JSON.stringify(tip));
check('hint keeps its closing bracket', /\]/.test(tip.bracket), JSON.stringify(tip));
await page.mouse.move(5, 5); await page.waitForTimeout(200);
check('hint tip hides when the pointer leaves', (await hint.evaluate((h) => getComputedStyle(h.querySelector('.tip')).opacity)) === '0');
console.log('== #20 the run button cannot be pressed on an error, the status says why');
await page.evaluate(() => document.querySelector('#run').click());
await page.waitForTimeout(300);
check('a programmatic click on the disabled run starts nothing', (await lintState()).hasErrors && (await page.evaluate(() => window.dewfpga.pendingRequests)) === 0 && !/compiling/.test(await status()), await status());
await page.locator('#editors .editor:not([hidden]) .cm-content').click(); await page.keyboard.press('ControlOrMeta+Enter');
await page.waitForTimeout(300);
check('⌘↵ on an error refuses with a status pointing at the problems panel', /not running — fix the errors in the problems panel/.test(await status()), await status());
console.log('== #20 fixing the file clears marks and reopens run');
await typeInto('tb.sv', 'module tb; logic c=0; always #1 c=~c; endmodule');
await waitLint();
check('valid tb.sv: lint settles clean', !(await lintState()).hasErrors && (await lintState()).settled, JSON.stringify(await lintState()));
check('problems panel empty', /problems · none/.test(await page.locator('#problems-label').innerText()) && (await page.locator('#problems .p-row').count()) === 0, await page.locator('#problems-label').innerText());
check('no error mark remains', (await marks('cm-diag-error')) === 0, String(await marks('cm-diag-error')));
check('run enabled again', !(await runDisabled()));
const t0 = Date.now(); await page.click('#run');
await waitStatus(/stopped/, 60000);
check('watchdog stops a testbench without $finish', Date.now() - t0 < 45000, `${Math.round((Date.now() - t0) / 1000)} s`);
check('a runtime stop is not a lint error', !(await lintState()).hasErrors && !(await runDisabled()), JSON.stringify(await lintState()));
console.log('== #20 stale verdicts: broken then fixed before the first reply, the final state is open');
await typeInto('tb.sv', 'module tb; initial begin $display("x" endmodule');
await page.waitForTimeout(450);   // the broken text is in flight (or about to be)
await typeInto('tb.sv', 'module tb; initial begin $display("fixed"); $finish; end endmodule');
await waitLint();
check('the later valid text wins over the earlier broken one', !(await lintState()).hasErrors && !(await runDisabled()) && (await page.locator('#problems .p-row').count()) === 0, JSON.stringify(await lintState()));
console.log('== #20 an Icarus "sorry" is a warning: the design stays runnable');
await page.evaluate(() => window.dewfpga.files.remove('m2.sv'));   // m2.sv (inv) would otherwise be a second top once blink stops instantiating it
await typeInto('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n  logic [3:0] sel;\n  always_comb begin\n    sel = sw[3:0];\n    led = \'0;\n    case (sel)\n      4\'d0: led[0] = 1\'b1;\n      default: led[1] = 1\'b1;\n    endcase\n  end\nendmodule');
await typeInto('tb.sv', 'module tb; logic clk=0; logic [15:0] sw=0, led; blink u(.clk(clk), .sw(sw), .led(led)); initial begin #1 if (led[0] !== 1) $error("led0"); sw = 3; #1 if (led[1] !== 1) $error("led1"); $display("PASS mux"); $finish; end endmodule');
await waitLint();
const muxLint = await lintState();
const muxProblems = await page.locator('#problems').innerText();
check('constant-select always_comb: no error, run open', !muxLint.hasErrors && !(await runDisabled()), JSON.stringify(muxLint) + ' ' + muxProblems.split('\n')[0]);
check('its "sorry" lines, if any, are listed as warnings not errors', !/\berror\b/i.test(muxProblems.replace(/\$error/g, '')), muxProblems);
await page.click('#run');
await waitStatus(/compile \d+ ms|run failed|failed|stopped/, 60000);
check('the warning-only design runs and passes', /PASS mux/.test(await page.locator('#out').innerText()) && /compile \d+ ms/.test(await status()), (await page.locator('#out').innerText()).split('\n').slice(0, 3).join(' | ') + ' · ' + await status());
console.log('== #20 the board view lints with yosys, a located error closes run');
await page.click('#view-board');
await typeInto('design.sv', 'module top(input logic a, output logic b); inv u(.a(a), .y(b)); assign b = a +; endmodule');
await waitLint(120000);
check('yosys error lands in the problems panel with design.sv', (await lintState()).hasErrors && /design\.sv/.test(await page.locator('#problems').innerText()), (await page.locator('#problems').innerText()).split('\n')[0]);
check('board view: run disabled on the error', await runDisabled());
check('board view: error mark on the design line', (await marks('cm-diag-error')) >= 1, String(await marks('cm-diag-error')));
await page.locator('#editors .editor:not([hidden]) .cm-content').click(); await page.keyboard.press('ControlOrMeta+Enter'); await page.waitForTimeout(200);
check('board view: ⌘↵ refuses on the error', /not running/.test(await status()), await status());
console.log('== #20 an error in a file you are not looking at marks that file, and the switch shows it');
await typeInto('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = sw; endmodule');
await waitLint(120000);
check('board design valid again: run open', !(await lintState()).hasErrors && !(await runDisabled()), JSON.stringify(await lintState()));
await page.click('#view-tb');
await waitStatus(/compile \d+ ms|run failed|failed|stopped/, 60000);
await typeInto('tb.sv', 'module tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("x" endmodule');
await page.click('.ftab[data-tab="design.sv"]');
await waitLint();
check('tb.sv error found while design.sv is active; the active editor has no mark', (await lintState()).hasErrors && (await marks('cm-diag-error')) === 0, JSON.stringify(await lintState()));
await page.click('.ftab[data-tab="tb.sv"]');
check('switching to tb.sv shows the mark', (await marks('cm-diag-error')) >= 1, String(await marks('cm-diag-error')));
await page.locator('#problems .c-link[data-file="tb.sv"]').first().click();
check('clicking the problem opens tb.sv', (await page.locator('.ftab[data-tab="tb.sv"]').getAttribute('class') || '').includes('on'), await page.locator('.ftab[data-tab="tb.sv"]').getAttribute('class'));
console.log('== #20 rename keeps the marks, delete of the broken file clears its error');
await page.evaluate(() => window.dewfpga.files.rename('tb.sv', 'bench.sv'));
await waitLint();
check('after rename the error moves to bench.sv', (await lintState()).hasErrors && /bench\.sv:\d+/.test(await page.locator('#problems').innerText()), (await page.locator('#problems').innerText()).split('\n')[0]);
await page.click('.ftab[data-tab="bench.sv"]');
check('renamed editor still carries the mark', (await marks('cm-diag-error')) >= 1, String(await marks('cm-diag-error')));
await page.evaluate(() => window.dewfpga.files.remove('bench.sv'));
await waitLint();
check('without a testbench the tb view reports no-testbench and run stays closed', (await lintState()).hasErrors && /no testbench/.test(await page.locator('#problems').innerText()), (await page.locator('#problems').innerText()).split('\n')[0]);
await page.evaluate(() => window.dewfpga.files.add('tb.sv', 'module tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("back"); $finish; end endmodule'));
await waitLint();
check('adding a testbench back reopens run', !(await lintState()).hasErrors && !(await runDisabled()), JSON.stringify(await lintState()));
// the example loaded above pins only sw and led; the clocked designs below need clk pinned
const xdcBefore = await page.evaluate(() => window.dewfpga.files.text('basys3.xdc'));
await page.evaluate((t) => window.dewfpga.files.set('basys3.xdc', t + '\nset_property -dict { PACKAGE_PIN W5 IOSTANDARD LVCMOS33 } [get_ports clk]\ncreate_clock -period 10.000 [get_ports clk]\n'), xdcBefore);
console.log('== #20 returning to the board after lint churn runs the valid design');
await page.click('#view-board');
await waitStatus(/combinational|not running|simulated clock/, 120000);
check('board view after lint churn: valid design actually runs with no errors', !(await runDisabled()) && /combinational|simulated clock/.test(await status()) && !!(await page.evaluate(() => window.dewfpga.sim)) && !(await lintState()).hasErrors, await status());
console.log('== #20 typing on a design yosys reads slowly: checks do not queue up behind each other');
// a 1024-word memory takes yosys ~2 s per read; a keystroke every 450 ms outlives the 400 ms debounce each time
await page.evaluate(() => { window.__lintPosts = 0; const post = Worker.prototype.postMessage; Worker.prototype.postMessage = function (m, ...r) { if (m && m.kind === 'lint') window.__lintPosts++; return post.call(this, m, ...r); }; });
await page.evaluate(() => window.dewfpga.files.set('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n  logic [15:0] m [0:1023]; logic [9:0] wa, ra;\n  always_ff @(posedge clk) begin m[wa] <= sw; wa <= wa + 1; ra <= ra + 3; led <= m[ra]; end\n  // notes:\nendmodule'));
await waitLint(120000);
await page.evaluate(() => { window.__lintPosts = 0; });
await page.click('.ftab[data-tab="design.sv"]');
await page.locator('#editors .editor:not([hidden]) .cm-line', { hasText: '// notes:' }).click();
await page.keyboard.press('End');
let burstPending = 0;
for (let i = 0; i < 20; i++) { await page.keyboard.type('x'); await page.waitForTimeout(450); burstPending = Math.max(burstPending, await page.evaluate(() => window.dewfpga.pendingRequests)); }
const burstPosts = await page.evaluate(() => window.__lintPosts);
check('20 keystrokes: at most one check waits in the yosys queue', burstPending <= 1, `max pending ${burstPending}, lint posts ${burstPosts}`);
check('20 keystrokes: fewer checks than keystrokes reach yosys', burstPosts < 20, String(burstPosts));
const tBurst = Date.now();
await page.click('#run');
await waitStatus(/simulated clock|combinational|not running|did not finish/, 120000);
await waitLint(60000);
check('a run pressed after the burst settles without waiting out a backlog', Date.now() - tBurst < 45000 && /simulated clock/.test(await status()) && /problems · none/.test(await page.locator('#problems-label').innerText()), `${Date.now() - tBurst} ms · ${await status()} · ${await page.locator('#problems-label').innerText()}`);
console.log('== #20 a check that runs out of time leaves the sources unchecked, not clean and not broken');
await page.evaluate(() => { window.__workers = 0; const W = window.Worker; window.Worker = class extends W { constructor(...a) { super(...a); window.__workers++; } }; window.dewfpga.lintTimeout.board = 1; });
await page.evaluate(() => window.dewfpga.files.set('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = ~sw; endmodule'));
await waitLint(120000);
let label = await page.locator('#problems-label').innerText();
check('board check timed out: the panel says unchecked, not none', !/none/.test(label) && /unchecked/.test(await page.locator('#problems').innerText()), label + ' · ' + await page.locator('#problems').innerText());
check('board check timed out: run stays open and the worker was replaced', !(await runDisabled()) && !(await lintState()).hasErrors && (await page.evaluate(() => window.__workers)) >= 1, JSON.stringify({ disabled: await runDisabled(), workers: await page.evaluate(() => window.__workers) }));
await page.evaluate(() => { window.dewfpga.lintTimeout.board = 90000; });
await page.click('#run');
await waitStatus(/simulated clock|combinational|not running|did not finish/, 120000);
await waitLint(60000);
check('run on the new worker compiles and replaces the unchecked note', /combinational|simulated clock/.test(await status()) && /problems · none/.test(await page.locator('#problems-label').innerText()), (await status()) + ' · ' + await page.locator('#problems-label').innerText());
await page.evaluate(() => window.dewfpga.files.set('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = sw +; endmodule'));
await waitLint(120000);
check('after the timeout a broken edit is still caught and closes run', (await lintState()).hasErrors && await runDisabled(), JSON.stringify(await lintState()));
await page.evaluate(() => window.dewfpga.files.set('design.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = sw; endmodule'));
await page.click('#view-tb');
await waitStatus(/compile \d+ ms|run failed|failed|stopped/, 60000);
await page.evaluate(() => { window.dewfpga.lintTimeout.tb = 1; });
await page.evaluate(() => window.dewfpga.files.set('tb.sv', 'module tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("slow"); $finish; end endmodule'));
await waitLint();
label = await page.locator('#problems-label').innerText();
check('testbench check timed out: unchecked, not none, run open', !/none/.test(label) && /unchecked/.test(await page.locator('#problems').innerText()) && !(await runDisabled()), label);
await page.evaluate(() => { window.dewfpga.lintTimeout.tb = 60000; });
await page.evaluate(() => window.dewfpga.files.set('tb.sv', 'module tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("x" endmodule'));
await waitLint();
check('with the time restored the testbench check finds the error again', (await lintState()).hasErrors && await runDisabled(), JSON.stringify(await lintState()));
console.log('== #20 a header error marks the header, a missing include marks the directive');
await page.evaluate(() => { window.dewfpga.files.add('defs.svh', 'localparam int W = 4;\nlocalparam int V = ;\n'); window.dewfpga.files.set('tb.sv', '`include "defs.svh"\nmodule tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("x"); $finish; end endmodule'); });
await waitLint();
check('iverilog: the header error is listed as defs.svh:2', /^defs\.svh:2: /m.test(await page.locator('#problems').innerText()), await page.locator('#problems').innerText());
await page.click('.ftab[data-tab="defs.svh"]');
check('iverilog: the header carries the mark on line 2', await page.locator('#editors .editor:not([hidden]) .cm-line').nth(1).evaluate((l) => l.classList.contains('cm-diag-error')));
await page.evaluate(() => { window.dewfpga.files.remove('defs.svh'); window.dewfpga.files.set('tb.sv', '`include "nope.svh"\nmodule tb; blink u(.clk(1\'b0), .sw(16\'d0), .led()); initial begin $display("x"); $finish; end endmodule'); });
await waitLint();
await page.click('.ftab[data-tab="tb.sv"]');
check('iverilog: a missing include is an error on the directive line', (await lintState()).hasErrors && /tb\.sv:1: error: Include file nope\.svh not found/.test(await page.locator('#problems').innerText()) && await page.locator('#editors .editor:not([hidden]) .cm-line').nth(0).evaluate((l) => l.classList.contains('cm-diag-error')), await page.locator('#problems').innerText());
await page.click('#view-board');
await page.evaluate(() => window.dewfpga.files.set('design.sv', '`include "nope.svh"\nmodule blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = sw; endmodule'));
await waitLint(120000);
await page.click('.ftab[data-tab="design.sv"]');
check('yosys: a missing include is located on the directive line', /design\.sv:1: .*nope\.svh/.test(await page.locator('#problems').innerText()) && await page.locator('#editors .editor:not([hidden]) .cm-line').nth(0).evaluate((l) => l.classList.contains('cm-diag-error')), await page.locator('#problems').innerText());
await page.evaluate((t) => { window.dewfpga.files.set('basys3.xdc', t); window.dewfpga.files.set('design.sv', 'module blink(input logic [15:0] sw, output logic [15:0] led); assign led = sw; endmodule'); window.dewfpga.files.set('tb.sv', 'module tb; blink u(.sw(16\'d0), .led()); initial begin $display("x"); $finish; end endmodule'); }, xdcBefore);
await waitLint(120000);
check('restored design: run open again', !(await runDisabled()) && !(await lintState()).hasErrors, JSON.stringify(await lintState()));

console.log('== old links keep working');
const oldHash = lz.compressToEncodedURIComponent(JSON.stringify({ sv: 'module top(input logic a, output logic b); assign b = a; endmodule', tb: 'module tb; initial begin $display("hello from an old link"); $finish; end endmodule' }));
await page.goto(BASE + 'tb.html#' + oldHash);
await page.waitForTimeout(800);
check('tb.html redirects to ?view=tb and keeps the hash', page.url().includes('?view=tb') && page.url().includes('#' + oldHash), page.url());
await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
check('old {sv, tb} link: tb.sv came from the link', (await page.locator('#out').innerText()).includes('hello from an old link'), (await page.locator('#out').innerText()).split('\n')[0]);
await page.goto(BASE + '?view=tb');
await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
check('?view=tb boots straight into the testbench', await page.locator('#view-tb').getAttribute('class') === 'on');

console.log('== #18 workspace: free names, content decides top and testbench');
// start from an empty browser: the old-link workspace above was autosaved, and the pagehide flush would save it again
await page.evaluate(() => { window.dewfpga.store.flush = () => {}; localStorage.clear(); });
await page.goto(BASE); await waitStatus(/simulated clock|combinational|not running/, 120000);
await page.evaluate(() => { const f = window.dewfpga.files; f.rename('design.sv', 'lab/counter_lab.sv'); f.rename('tb.sv', 'lab/sim/my_test.sv'); f.rename('basys3.xdc', 'lab/pins.xdc'); });
check('free-names-content-top: tabs keep the names and paths', (await page.locator('#ftabs .ftab').allInnerTexts()).join(',') === 'lab/counter_lab.sv,lab/sim/my_test.sv,lab/pins.xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(','));
let roles = await page.evaluate(() => window.dewfpga.roles);
check('free-names-content-top: top blink from lab/counter_lab.sv, testbench blink_tb from lab/sim/my_test.sv', roles.top === 'blink' && roles.topFile === 'lab/counter_lab.sv' && roles.tb === 'blink_tb' && roles.tbFile === 'lab/sim/my_test.sv' && roles.xdc === 'lab/pins.xdc', JSON.stringify(roles));
check('roles line shows them', /top blink.*testbench blink_tb.*xdc lab\/pins\.xdc/s.test(await page.locator('#roles').innerText()), await page.locator('#roles').innerText());
await page.click('#run'); await waitStatus(/simulated clock/, 60000);
check('free-names-content-top: board runs under the free names', /simulated clock/.test(await status()), await status());
await page.click('#view-tb'); await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
check('free-names-content-top: testbench runs under the free names (PASS: 3 checks)', (await page.locator('#out').innerText()).includes('PASS: 3 checks'), (await page.locator('#out').innerText()).split('\n').slice(0, 2).join(' | '));
check('console error links use the real path', await page.evaluate(() => { const f = window.dewfpga.files; return f.has('lab/counter_lab.sv') && f.text('lab/counter_lab.sv').includes('module blink'); }));
await page.evaluate(() => window.dewfpga.files.add('extra.sv', 'module extra(input logic a, output logic b); assign b = a; endmodule'));
roles = await page.evaluate(() => window.dewfpga.roles);
check('two tops -> explicit choice, nothing guessed', roles.error && roles.error.code === 'two-tops' && !roles.top && (await page.locator('#roles select').count()) === 1, JSON.stringify(roles.error));
await page.selectOption('#roles select.role-pick >> nth=0', 'blink');
roles = await page.evaluate(() => window.dewfpga.roles);
check('picked top sticks', roles.top === 'blink' && !roles.error, JSON.stringify(roles));
await page.evaluate(() => window.dewfpga.files.remove('extra.sv'));
check('remove works on any file', !(await page.evaluate(() => window.dewfpga.files.has('extra.sv'))));
await page.evaluate(() => window.dewfpga.files.rename('lab/counter_lab.sv', '../x.sv'));
check('bad rename refused, file kept', await page.evaluate(() => window.dewfpga.files.has('lab/counter_lab.sv')) && /\.\./.test(await status()), await status());

console.log('== #18 mem-and-header-input: .mem and .svh stay in the workspace and the zip');
await page.evaluate(() => { const f = window.dewfpga.files; f.add('inc/defs.svh', '`define WIDTH 4\n'); f.add('rom.mem', '0\n1\n2\n3\n'); });
check('mem-and-header-input: tabs list them', (await page.locator('#ftabs .ftab').allInnerTexts()).includes('inc/defs.svh') && (await page.locator('#ftabs .ftab').allInnerTexts()).includes('rom.mem'));
roles = await page.evaluate(() => window.dewfpga.roles);
check('mem-and-header-input: they are never top or testbench', roles.top === 'blink' && roles.tb === 'blink_tb' && roles.tops.length === 1, JSON.stringify(roles));

console.log('== #18 two-xdc-choice');
await page.evaluate(() => window.dewfpga.files.add('other.xdc', '## second constraints file\n'));
roles = await page.evaluate(() => window.dewfpga.roles);
check('two-xdc-choice: two .xdc, neither named after the top -> no guess, selector shown', roles.xdcError && roles.xdcError.code === 'two-xdc-files' && !roles.xdc && (await page.locator('#roles select').count()) === 1, JSON.stringify(roles.xdcError));
await page.click('#view-board'); await waitStatus(/not running/, 60000);
check('two-xdc-choice: board refuses to guess (not running, two-xdc-files in console)', /two-xdc-files/.test(await page.locator('#console').innerText()), (await page.locator('#console').innerText()).split('\n')[0]);
await page.selectOption('#roles select.role-pick', 'lab/pins.xdc');
await page.click('#run'); await waitStatus(/simulated clock/, 60000);
check('two-xdc-choice: picked xdc runs the board', (await page.evaluate(() => window.dewfpga.roles)).xdc === 'lab/pins.xdc' && /simulated clock/.test(await status()), await status());
// the choice is a path: it follows a rename of its file (case-only too) and is dropped with the file, so a new file under the old name is not picked unasked
await page.evaluate(() => window.dewfpga.files.rename('lab/pins.xdc', 'lab/Pins.xdc'));
roles = await page.evaluate(() => window.dewfpga.roles);
check('two-xdc-choice: renaming the picked xdc keeps it picked (case-only rename)', roles.xdc === 'lab/Pins.xdc' && !roles.xdcError, JSON.stringify({ xdc: roles.xdc, err: roles.xdcError && roles.xdcError.code }));
await page.evaluate(() => window.dewfpga.files.rename('lab/Pins.xdc', 'lab/pins.xdc'));
await page.selectOption('#roles select.role-pick', 'other.xdc');
await page.evaluate(() => { window.dewfpga.files.remove('other.xdc'); window.dewfpga.files.add('other.xdc', '## a new file under the removed name\n'); });
roles = await page.evaluate(() => window.dewfpga.roles);
check('two-xdc-choice: a removed pick is not inherited by a new file of the same name', !roles.xdc && roles.xdcError && roles.xdcError.code === 'two-xdc-files', JSON.stringify({ xdc: roles.xdc, err: roles.xdcError && roles.xdcError.code }));
await page.selectOption('#roles select.role-pick', 'lab/pins.xdc');
await page.evaluate(() => window.dewfpga.files.rename('other.xdc', 'blink.xdc'));
roles = await page.evaluate(() => window.dewfpga.roles);
check('two-xdc-choice: an explicit choice remains selected when a top-named xdc appears', roles.xdc === 'lab/pins.xdc' && !roles.xdcError, JSON.stringify({ xdc: roles.xdc, why: roles.why }));

console.log('== #18 reload-restoresedit: autosave 400 ms, versioned, reload brings the workspace back');
await typeInto('lab/counter_lab.sv', 'module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led); assign led = sw; endmodule // reload-marker');
await page.waitForTimeout(700);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dewfpga.workspace')));
check('reload-restoresedit: dewfpga.workspace is v1 with every file and the choice', stored && stored.v === 1 && stored.files.length === 6 && stored.files.some((f) => f.path === 'lab/counter_lab.sv' && f.text.includes('reload-marker')) && stored.prefer && stored.prefer.xdc === 'lab/pins.xdc', JSON.stringify(stored && { v: stored.v, n: stored.files.length, prefer: stored.prefer }));
const tabsBefore = (await page.locator('#ftabs .ftab').allInnerTexts()).join(',');
await page.reload(); await waitStatus(/simulated clock|combinational|not running/, 120000);
check('reload-restoresedit: names, text and active tab restored', tabsBefore.split(',').length === 6 && (await page.locator('#ftabs .ftab').allInnerTexts()).join(',') === tabsBefore && (await page.evaluate(() => window.dewfpga.files.text('lab/counter_lab.sv'))).includes('reload-marker'), (await page.locator('#ftabs .ftab').allInnerTexts()).join(','));
check('reload-restoresedit: no save error shown', (await page.locator('#savestate').innerText()) === '');
const quota = await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }; window.dewfpga.files.set('rom.mem', '9\n'); window.dewfpga.store.flush(); const s = document.querySelector('#savestate').textContent; Storage.prototype.setItem = o; return s; });
check('quota error is visible, never "saved"', /not saved.*storage is full/.test(quota), quota);

console.log('== #19 import: folder paths, atomic validation, confirmation');
const fix = path.join(S, 'fixture-lab'); fs.rmSync(fix, { recursive: true, force: true });
for (const [p, s] of Object.entries({ 'src/top_mod.sv': 'module top_mod(input logic [15:0] sw, output logic [15:0] led);\r\n  assign led = ~sw;\r\nendmodule\r\n', 'sim/top_mod_tb.sv': 'module top_mod_tb;\n  logic [15:0] sw, led; top_mod u(.sw(sw), .led(led));\n  initial begin sw = 16\'h00ff; #1; if (led !== 16\'hff00) $error("led"); $display("PASS: zip roundtrip"); $finish; end\nendmodule\n', 'inc/defs.svh': '`define W 16\n', 'data/rom.mem': '00\n11\n', 'top_mod.xdc': '' })) { fs.mkdirSync(path.dirname(path.join(fix, p)), { recursive: true }); fs.writeFileSync(path.join(fix, p), s); }
fs.copyFileSync(new URL('../../templates/blink.xdc', import.meta.url), path.join(fix, 'top_mod.xdc'));
fs.mkdirSync(path.join(fix, '.Xil'), { recursive: true }); fs.writeFileSync(path.join(fix, '.Xil/junk.sv'), 'module junk; endmodule'); fs.writeFileSync(path.join(fix, 'notes.txt'), 'ignored');
const fixtureBytes = Object.fromEntries(['src/top_mod.sv', 'sim/top_mod_tb.sv', 'inc/defs.svh', 'data/rom.mem', 'top_mod.xdc'].map((p) => [p, fs.readFileSync(path.join(fix, p)).toString('hex')]));
await page.setInputFiles('#folder-input', fix);
await page.waitForTimeout(500);
check('dropfolderpaths: confirmation asked before replacing a non-empty workspace', dialogs.some((m) => /replace the 6 files/.test(m)), dialogs.join(' | '));
await waitStatus(/combinational|simulated clock|not running/, 120000);
check('dropfolderpaths: relative paths kept, root folder stripped, .Xil and .txt skipped', (await page.locator('#ftabs .ftab').allInnerTexts()).sort().join(',') === 'data/rom.mem,inc/defs.svh,sim/top_mod_tb.sv,src/top_mod.sv,top_mod.xdc', (await page.locator('#ftabs .ftab').allInnerTexts()).join(','));
roles = await page.evaluate(() => window.dewfpga.roles);
check('dropfolderpaths: top/testbench/xdc from content and name', roles.top === 'top_mod' && roles.tb === 'top_mod_tb' && roles.xdc === 'top_mod.xdc', JSON.stringify(roles));
check('dropfolderpaths: board runs the imported design (led5 on with sw5 off)', (await ledClass(5)).includes('on'), await status());
const dropRes = await page.evaluate(async () => { const dt = new DataTransfer(); dt.items.add(new File(['module a(input x); endmodule'], 'a.sv')); dt.items.add(new File(['x'], '../evil.sv')); const el = document.querySelector('.right'); el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true })); el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); await new Promise((r) => setTimeout(r, 300)); return { tabs: [...document.querySelectorAll('#ftabs .ftab')].map((b) => b.textContent).join(','), status: document.querySelector('#status').textContent, why: document.querySelector('#console').textContent, drop: el.classList.contains('drop') }; });
check('drop: an invalid file rejects the whole drop, workspace untouched, outline cleared', dropRes.tabs.split(',').length === 5 && /nothing was opened/.test(dropRes.status) && !dropRes.drop, JSON.stringify(dropRes));
check('drop: the rejection names the bad path, not a read failure', /\.\.\/evil\.sv: a path may not contain/.test(dropRes.why) && !/could not be read|does not exist/i.test(dropRes.why + dropRes.status), JSON.stringify(dropRes));
const dropOk = await page.evaluate(async () => { const dt = new DataTransfer(); dt.items.add(new File(['module a(input x, output y); assign y = x; endmodule'], 'a.sv')); dt.items.add(new File(['module a_tb; a u(.x(1), .y()); endmodule'], 'a_tb.sv')); document.querySelector('.right').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true })); await new Promise((r) => setTimeout(r, 300)); return [...document.querySelectorAll('#ftabs .ftab')].map((b) => b.textContent).join(','); });
check('drop: valid files replace the workspace after confirmation', dropOk === 'a.sv,a_tb.sv' && dialogs.length >= 2, dropOk);
await page.setInputFiles('#folder-input', fix); await waitStatus(/combinational|simulated clock|not running/, 120000);

console.log('== #19 export: zip-CLIroundtrip');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
const zipPath = path.join(S, 'workspace.zip'); await dl.saveAs(zipPath);
check('zip-CLIroundtrip: download named after the top', dl.suggestedFilename() === 'top_mod.zip', dl.suggestedFilename());
const { execFileSync } = await import('node:child_process');
const unz = path.join(S, 'unzipped'); fs.rmSync(unz, { recursive: true, force: true }); fs.mkdirSync(unz);
let unzipOut = ''; try { unzipOut = execFileSync('unzip', ['-o', zipPath, '-d', unz], { encoding: 'utf8' }); } catch (e) { unzipOut = 'unzip failed: ' + (e.stdout || e.message); }
const same = Object.entries(fixtureBytes).filter(([p, hex]) => fs.existsSync(path.join(unz, p)) && fs.readFileSync(path.join(unz, p)).toString('hex') === hex).map(([p]) => p);
check('zip-CLIroundtrip: every source byte-identical after unzip (CRLF kept)', same.length === 5 && !fs.existsSync(path.join(unz, 'notes.txt')), `${same.length}/5 identical; ${unzipOut.split('\n')[0]}`);
fs.writeFileSync(path.join(S, 'zip-cli-fixture.txt'), `${unz}\n`);
check('zip-CLIroundtrip: nested folders have a project file preserving top/XDC', fs.existsSync(path.join(unz, 'dewfpga-workspace.xpr')) && /project file preserving/.test(await status()), await status());
// flat workspace, the layout the command line reads: blink from templates, back out through the zip
const tpl = (n) => fs.readFileSync(new URL('../../templates/' + n, import.meta.url));
const flatSrc = { 'blink.sv': tpl('blink.sv'), 'blink_tb.sv': tpl('blink_tb.sv'), 'blink.xdc': tpl('blink.xdc') };
await page.evaluate((fs) => window.dewfpga.importRecords(Object.entries(fs).map(([path, bytes]) => ({ path, bytes })), 'test flat'), Object.fromEntries(Object.entries(flatSrc).map(([p, b]) => [p, Array.from(b)])));
await page.waitForTimeout(300);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
const zip2 = path.join(S, 'workspace-flat.zip'); await dl2.saveAs(zip2);
const unzFlat = path.join(S, 'unzipped-flat'); fs.rmSync(unzFlat, { recursive: true, force: true }); fs.mkdirSync(unzFlat);
try { execFileSync('unzip', ['-o', zip2, '-d', unzFlat], { encoding: 'utf8' }); } catch (e) { console.log('  unzip failed: ' + (e.stdout || e.message)); }
const sameFlat = Object.entries(flatSrc).filter(([p, b]) => fs.existsSync(path.join(unzFlat, p)) && fs.readFileSync(path.join(unzFlat, p)).equals(b)).length;
check('zip-CLIroundtrip: flat workspace -> zip named blink.zip, 3 files byte-identical, no folder note', dl2.suggestedFilename() === 'blink.zip' && sameFlat === 3 && !/one folder only/.test(await status()), `${dl2.suggestedFilename()} ${sameFlat}/3 ${await status()}`);
fs.writeFileSync(path.join(S, 'zip-cli-fixture.txt'), `${unzFlat}\n`);
console.log(`  zip-CLIroundtrip: CLI step: cd ${unzFlat} && dewfpga sim && dewfpga bit`);

console.log('== nested headers and ROM through both WASM engines');
const nestedInputs = nestedProject.filter((f) => !/other\.sv|unselected\.xdc/.test(f.path));
await page.evaluate((entries) => window.dewfpga.importRecords(entries, 'nested ROM fixture'), nestedInputs);
await waitStatus(/combinational|not running/, 120000);
const romBoard = await page.evaluate(() => {
  const w = window.dewfpga, failures = [];
  if (!w.sim) return ['no circuit'];
  for (let address = 0; address < 16; address++) {
    for (let i = 0; i < 4; i++) if (w.board.state.sw[i] !== ((address >> i) & 1)) w.board.toggleSwitch(i);
    const actual = w.board.led.slice(0,4).reduce((n,b,i) => n | ((b === 1 ? 1 : 0) << i), 0);
    if (actual !== (address ^ 10)) failures.push({ address, actual });
  }
  return failures;
});
check('nested header and ROM: synthesized board reads all 16 addresses correctly', romBoard.length === 0, JSON.stringify(romBoard));
await page.click('#view-tb'); await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
check('nested header and ROM: Icarus checks all 16 addresses', /PASS nested ROM all 16 addresses/.test(await page.locator('#out').innerText()), await page.locator('#out').innerText());
await page.evaluate(() => { window.dewfpga.store.flush(); });
await page.reload(); await waitStatus(/compile \d+ ms|failed|stopped/, 120000);
const restoredHeader = await page.evaluate(() => JSON.parse(localStorage.getItem('dewfpga.workspace')).files.find(f => f.path === 'inc/width.svh'));
check('reload preserves imported CRLF header', restoredHeader.eol === '\r\n', JSON.stringify(restoredHeader));
await page.click('#view-board'); await waitStatus(/combinational|not running/, 120000);
await page.evaluate(() => {
  document.querySelector('#run').click();
  window.dewfpga.files.set('rtl/top.sv', window.dewfpga.files.text('rtl/top.sv') + '\n// changed while compiling');
});
await page.waitForFunction(() => window.dewfpga.pendingRequests === 0, null, { timeout:120000 });
check('editing during compilation cannot start the old circuit or light DONE', await page.evaluate(() => !window.dewfpga.sim && !document.querySelector('.b-doneled').classList.contains('on')), await status());

console.log('== layout at 320 / 390 / 900 / 1366 (with a problems row and its hint on screen)');
await page.evaluate(() => window.dewfpga.files.set('rtl/top.sv', 'module top(input logic a, output logic b); assign b = a +; endmodule'));
await page.waitForFunction(() => { const l = window.dewfpga.lint; return l.settled && !l.pending && l.hasErrors && document.querySelector('#problems .hint'); }, null, { timeout: 120000 });
for (const w of [320, 390, 900, 1366]) {
  await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(150);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bar: document.querySelector('.pane-bar').scrollWidth, tap: Math.min(...[...document.querySelectorAll('.pane-bar button, .ftab')].map((b) => b.getBoundingClientRect().height)), hint: Math.min(...[...document.querySelectorAll('#problems .hint')].map((b) => b.getBoundingClientRect().height)), hintVisible: [...document.querySelectorAll('#problems .hint')].every((b) => { const r = b.getBoundingClientRect(); return r.right <= window.innerWidth && r.width > 0; }) }));
  check(`no horizontal overflow at ${w}`, m.sw <= m.iw, JSON.stringify(m));
  check(`hint button inside the viewport at ${w}`, m.hintVisible, JSON.stringify(m));
  if (w <= 390) check(`controls at least 40px tall at ${w}`, m.tap >= 40, JSON.stringify(m));
  if (w <= 390) check(`hint at least 40px tall at ${w}`, m.hint >= 40, JSON.stringify(m));
  await page.screenshot({ path: S + `/e2e-ws-${w}.png` });
}
await page.setViewportSize({ width: 1280, height: 900 });
} catch (e) {
  fail++;
  console.log(`  FAIL (step threw) ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: S + '/e2e-failed.png' }).catch(() => {});
}

console.log(`\npassed ${pass}, failed ${fail}`);
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
