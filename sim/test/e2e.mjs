// one workspace, two views. run: npm run build && npm run preview, then node test/e2e.mjs
import { chromium, webkit } from 'playwright';
import lz from 'lz-string';
const S = process.env.SHOTS || '/tmp';
const BASE = process.env.BASE || 'http://localhost:4173/';
const browser = process.env.BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}  ${detail}`); } };
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.type() + ': ' + m.text()); });
const status = () => page.locator('#status').innerText();
const waitStatus = (re, t = 180000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status').textContent), re.source, { timeout: t });
const ledClass = (i) => page.locator('#board .b-led').nth(i).getAttribute('class');
const typeInto = async (tab, text) => { await page.click(`.ftab[data-tab="${tab}"]`); await page.locator('#editors .editor:not([hidden]) .cm-content').click(); await page.keyboard.press('Meta+a'); await page.keyboard.type(text); };

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
check('blink_tb prints basic checks passed', out.includes('basic checks passed'), out.split('\n').slice(0, 3).join(' | '));
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
check('tb sees the edited design (led[0] now stuck at 1 -> $error)', (await page.locator('#out').innerText()).includes('led[0] must be 0'), (await page.locator('#out').innerText()).split('\n').slice(0, 3).join(' | '));
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

console.log('== error paths');
await typeInto('tb.sv', 'module tb; initial begin $display("x" endmodule');
await page.click('#run');
await waitStatus(/compile failed/, 60000);
check('iverilog error lands in the console', /tb\.sv:\d+/.test(await page.locator('#console').innerText()), (await page.locator('#console').innerText()).split('\n')[0]);
await typeInto('tb.sv', 'module tb; logic c=0; always #1 c=~c; endmodule');
const t0 = Date.now(); await page.click('#run');
await waitStatus(/stopped/, 60000);
check('watchdog stops a testbench without $finish', Date.now() - t0 < 45000, `${Math.round((Date.now() - t0) / 1000)} s`);
await page.click('#view-board');
await typeInto('design.sv', 'module top(input logic a, output logic b); assign b = a +; endmodule');
await page.click('#run');
await waitStatus(/not running/, 60000);
check('yosys error lands in the console', /design\.sv/.test(await page.locator('#console').innerText()), (await page.locator('#console').innerText()).split('\n')[0]);

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

console.log(`\npassed ${pass}, failed ${fail}`);
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
