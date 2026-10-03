// virtual basys3 board: buttons, switches, POWER/DONE, and the code <-> board hover link, in a real browser.
// run: BASE=http://127.0.0.1:4173/ node test/board-e2e.mjs against a running `npm run preview` (or npm run build && vite preview).
// every check prints PASS/FAIL with the observed value; the exit code is the number of failures (0 = all passed).
import { chromium, webkit, firefox } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const S = process.env.E2E_OUT || path.join(os.tmpdir(), 'dewfpga-board-e2e');
fs.mkdirSync(S, { recursive: true });
const BASE = process.env.BASE || 'http://127.0.0.1:4173/';
const browserName = process.env.BROWSER || 'chromium';
const type = { chromium, webkit, firefox }[browserName];
if (!type) throw new Error(`unsupported BROWSER=${browserName}`);
const launch = { headless: !process.env.E2E_HEADED };
if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
const browser = await type.launch(launch);
console.log(`browser ${browserName} ${browser.version()}  base ${BASE}  out ${S}`);
let page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  PASS ${name}`); } else { fail++; console.log(`  FAIL ${name}  ${detail}`); } };
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const status = () => page.locator('#status').innerText();
const waitStatus = (re, t = 120000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#status').textContent), re.source, { timeout: t });
const waitIdle = () => page.waitForFunction(() => window.dewfpga.pendingRequests === 0, null, { timeout: 120000 });
const ledClass = (i) => page.locator('#board .b-led').nth(i).getAttribute('class');
const btnState = () => page.evaluate(() => ({ ...window.dewfpga.board.state.btn }));
const swState = () => page.evaluate(() => [...window.dewfpga.board.state.sw]);
const simBit = (port, bit) => page.evaluate(([p, b]) => window.dewfpga.sim ? window.dewfpga.sim.outBit(p, b) : 'no-sim', [port, bit]);
const done = () => page.locator('#board .b-doneled').evaluate((e) => e.classList.contains('on'));
const power = () => page.locator('#board .b-pwrled').evaluate((e) => e.classList.contains('on'));
const labels = () => page.locator('#board .b-labels .b-port').count();
const hl = () => page.evaluate(() => [...document.querySelectorAll('#board .hl')].map((e) => e.getAttribute('data-sw') ?? e.getAttribute('data-btn') ?? e.getAttribute('data-led') ?? e.getAttribute('class')).join(','));
const tip = async () => { const t = page.locator('#board-tip, .b-tip'); return (await t.count()) && await t.first().isVisible() ? (await t.first().innerText()).replace(/\s+/g, ' ').trim() : ''; };
const cmMarks = () => page.evaluate(() => [...document.querySelectorAll('#editors .editor:not([hidden]) .cm-board-hl')].map((e) => e.textContent).join('|'));
const caret = () => page.evaluate(() => { const v = window.dewfpga.files.get(window.dewfpga.files.active).view; return { anchor: v.state.selection.main.anchor, head: v.state.selection.main.head, focused: v.hasFocus, activeTag: document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName) }; });
const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const setFile = async (p, text) => { await page.evaluate(([p, t]) => window.dewfpga.files.set(p, t), [p, text]); };
const runAndWait = async (re) => { await page.click('#run'); await waitStatus(re); await waitIdle(); await page.waitForTimeout(150); };
// coordinates of the n-th occurrence of `word` inside `file` in the open editor (the editor must be shown)
const wordAt = async (file, word, nth = 0) => {
  const i = await page.evaluate(([file, word, nth]) => {
    const ed = window.dewfpga.files.get(file); const t = ed.text; let i = -1; for (let k = 0; k <= nth; k++) i = t.indexOf(word, i + 1);
    if (i >= 0) { const box = ed.view.dom.closest('.editor') || ed.view.scrollDOM; box.scrollTop = Math.max(0, ed.view.lineBlockAt(i).top - 40); ed.view.requestMeasure(); }   // CodeMirror renders only the visible lines; .editor is the scroll box
    return i;
  }, [file, word, nth]);
  if (i < 0) return null;
  await page.waitForTimeout(120);
  return page.evaluate(([file, i]) => { const c = window.dewfpga.files.get(file).view.coordsAtPos(i + 1); return c ? { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2, pos: i } : null; }, [file, i]);
};
const DESIGN = `module blink(input logic clk, input logic [15:0] sw, input logic btnC, output logic [15:0] led);
  assign led[0] = btnC;
  assign led[1] = sw[1];
  assign led[15] = sw[0];
  logic [3:0] hq;
  helper h(.led(sw[7:4]), .q(hq));
  assign led[7:4] = hq;
endmodule
module helper(input logic [3:0] led, output logic [3:0] q);
  assign q = ~led;
endmodule
`;

try {
console.log('== boot: blink, POWER and DONE');
await page.goto(BASE);
await waitStatus(/simulated clock|combinational|error|not running/);
await waitIdle();
check('POWER on after boot', await power());
check('DONE on after a valid run', await done());
check('port labels on the board', (await labels()) > 0, String(await labels()));

console.log('== design with btnC → led0, sw1 → led1, led[14:8] undriven');
const xdc0 = await page.evaluate(() => window.dewfpga.files.text('basys3.xdc'));
await setFile('design.sv', DESIGN);
await setFile('basys3.xdc', xdc0 + '\nset_property -dict { PACKAGE_PIN U18 IOSTANDARD LVCMOS33 } [get_ports { btnC }]\n');
await runAndWait(/simulated clock|not running/);
check('runs (simulated clock)', /simulated clock/.test(await status()), await status());
check('led0 off while btnC up', !(await ledClass(0)).includes('on'), await ledClass(0));
const undriven = await ledClass(10);
check('undriven led10 is shown as unknown (.x), not off and not on', /\bx\b/.test(undriven) && !/\bon\b/.test(undriven), undriven);

console.log('== pushbutton: momentary under the mouse, released by blur / hidden / lost capture');
const bc = await center('#board .b-btn[data-btn=btnC]');
await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.waitForTimeout(120);
check('mouse down: btnC=1 and led0 on', (await btnState()).btnC === 1 && (await ledClass(0)).includes('on'), JSON.stringify(await btnState()) + ' ' + await ledClass(0));
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(120);
check('window blur while held: btnC=0 and led0 off', (await btnState()).btnC === 0 && !(await ledClass(0)).includes('on'), JSON.stringify(await btnState()) + ' ' + await ledClass(0));
await page.mouse.up(); await page.waitForTimeout(60);
check('late mouse up after blur: still 0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.waitForTimeout(80);
await page.mouse.move(5, 5, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(80);
check('released outside the button: btnC=0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.waitForTimeout(80);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(80);
check('document hidden while held: btnC=0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.evaluate(() => { delete document.visibilityState; });
await page.mouse.up(); await page.waitForTimeout(60);
await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.waitForTimeout(80);
await page.locator('#board .b-btn[data-btn=btnC]').dispatchEvent('pointercancel');
await page.waitForTimeout(80);
check('pointercancel while held: btnC=0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.mouse.up(); await page.waitForTimeout(60);
await page.mouse.move(bc.x, bc.y); await page.mouse.down(); await page.waitForTimeout(80);
await page.locator('#board .b-btn[data-btn=btnC]').dispatchEvent('lostpointercapture');
await page.waitForTimeout(80);
check('lostpointercapture while held: btnC=0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.mouse.up(); await page.waitForTimeout(60);
check('after all of that: led0 off, no stuck button', !(await ledClass(0)).includes('on') && Object.values(await btnState()).every((v) => v === 0), JSON.stringify(await btnState()));

console.log('== keyboard: board-level arrows/enter, then focus leaves the board while enter is held');
await page.locator('#board').focus();
await page.keyboard.down('Enter'); await page.waitForTimeout(100);
check('enter on the focused board: btnC=1, led0 on', (await btnState()).btnC === 1 && (await ledClass(0)).includes('on'), JSON.stringify(await btnState()));
await page.locator('#editors .editor:not([hidden]) .cm-content').click();   // focus moves to the editor with the key still down
await page.waitForTimeout(60);
await page.keyboard.up('Enter'); await page.waitForTimeout(100);
check('focus left the board with enter held: btnC released (not stuck high)', (await btnState()).btnC === 0 && !(await ledClass(0)).includes('on'), JSON.stringify(await btnState()) + ' ' + await ledClass(0));
const stray = await page.evaluate(() => window.dewfpga.files.text('design.sv') !== undefined);
check('editor still intact', stray);

console.log('== keyboard in the editor must not drive the board');
await page.locator('#editors .editor:not([hidden]) .cm-content').click();
await page.keyboard.press('End');
for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space']) { await page.keyboard.down(k); await page.waitForTimeout(30); }
const during = await btnState();
for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space']) await page.keyboard.up(k);
await page.waitForTimeout(60);
check('arrows/enter/space typed in the editor leave every button at 0', Object.values(during).every((v) => v === 0), JSON.stringify(during));
// those keys were typed into design.sv: the edit invalidated the run (DONE off), so restore the file and run again
check('typing in the editor invalidated the run (DONE off, no circuit)', !(await done()) && !(await page.evaluate(() => !!window.dewfpga.sim)));
await setFile('design.sv', DESIGN);
await runAndWait(/simulated clock|not running/);
check('runs again after the restore', /simulated clock/.test(await status()), await status());

console.log('== per-control keyboard: tab to a switch / button, space and enter act on that control only');
await page.locator('#board .b-sw[data-sw="1"]').focus();
const swFocus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-sw'));
check('a switch can take focus', swFocus === '1', String(swFocus));
await page.keyboard.press('Space'); await page.waitForTimeout(120);
check('space on focused sw1 toggles it on and led1 lights', (await swState())[1] === 1 && (await ledClass(1)).includes('on'), JSON.stringify((await swState()).slice(0, 3)) + ' ' + await ledClass(1));
await page.locator('#board .b-btn[data-btn=btnC]').focus();
await page.keyboard.down('Space'); await page.waitForTimeout(80);
check('space held on focused btnC: 1', (await btnState()).btnC === 1, JSON.stringify(await btnState()));
await page.keyboard.up('Space'); await page.waitForTimeout(80);
check('space released: 0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.keyboard.down('Enter'); await page.waitForTimeout(60);
await page.locator('#board .b-btn[data-btn=btnC]').evaluate((e) => e.blur());
await page.keyboard.up('Enter'); await page.waitForTimeout(80);
check('button blurred while enter held: released', (await btnState()).btnC === 0, JSON.stringify(await btnState()));

console.log('== the same button held by the keyboard and the pointer: releasing one keeps it down');
const bk = await center('#board .b-btn[data-btn=btnC]');
await page.locator('#board .b-btn[data-btn=btnC]').focus();
await page.keyboard.down('Enter'); await page.waitForTimeout(60);
await page.mouse.move(bk.x, bk.y); await page.mouse.down(); await page.waitForTimeout(60);
await page.keyboard.up('Enter'); await page.waitForTimeout(80);
check('enter released while the pointer still holds btnC: 1', (await btnState()).btnC === 1, JSON.stringify(await btnState()));
await page.mouse.up(); await page.waitForTimeout(80);
check('pointer released too: 0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));
await page.mouse.move(bk.x, bk.y); await page.mouse.down(); await page.waitForTimeout(60);
await page.keyboard.down('Space'); await page.waitForTimeout(60);
await page.mouse.up(); await page.waitForTimeout(80);
check('pointer released while space still holds btnC: 1', (await btnState()).btnC === 1, JSON.stringify(await btnState()));
await page.keyboard.up('Space'); await page.waitForTimeout(80);
check('space released too: 0', (await btnState()).btnC === 0, JSON.stringify(await btnState()));

console.log('== recompile keeps switch values and applies the buttons that are held now');
check('sw1 still on before recompile', (await swState())[1] === 1);
const bc2 = await center('#board .b-btn[data-btn=btnC]');   // layout may have shifted since the first measurement
await page.mouse.move(bc2.x, bc2.y); await page.mouse.down(); await page.waitForTimeout(80);
check('btnC held by the mouse before recompile', (await btnState()).btnC === 1, JSON.stringify(await btnState()));
await page.evaluate(() => document.querySelector('#run').click()); await waitStatus(/simulated clock|not running/); await waitIdle(); await page.waitForTimeout(150);
check('after recompile: sw1 kept, led1 on', (await swState())[1] === 1 && (await ledClass(1)).includes('on'), await ledClass(1));
check('after recompile: held btnC is applied, led0 on', (await btnState()).btnC === 1 && (await ledClass(0)).includes('on'), JSON.stringify(await btnState()) + ' ' + await ledClass(0));
await page.mouse.up(); await page.waitForTimeout(100);
check('release after recompile: led0 off', (await btnState()).btnC === 0 && !(await ledClass(0)).includes('on'), await ledClass(0));

console.log('== hover board → code: names, bits, pins; code highlighted; caret and focus untouched');
await page.locator('#editors .editor:not([hidden]) .cm-content').click();
await page.keyboard.press('Home');
const before = await caret();
await page.locator('#board .b-led').nth(1).hover(); await page.waitForTimeout(120);
const t1 = await tip();
check('hovering led1 shows its name, bit and pin', /led\[1\]/.test(t1) && /E19/.test(t1), t1);
check('hovering led1 highlights the led port in the top module code', /led/.test(await cmMarks()), await cmMarks());
const after = await caret();
check('hover does not move the caret or steal focus', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
await page.locator('#board .b-btn[data-btn=btnC]').hover(); await page.waitForTimeout(120);
const t2 = await tip();
check('hovering btnC shows btnC and U18', /btnC/.test(t2) && /U18/.test(t2), t2);
await page.locator('#board .b-sw[data-sw="0"]').hover(); await page.waitForTimeout(120);
check('hovering sw0 shows sw[0] and V17', /sw\[0\]/.test(await tip()) && /V17/.test(await tip()), await tip());
await page.locator('#board .b-led').nth(5).hover(); await page.waitForTimeout(120);
check('hovering an unbound-value led still names it (led[5], U15)', /led\[5\]/.test(await tip()), await tip());
await page.mouse.move(640, 20); await page.waitForTimeout(150);
check('leaving the board clears the tooltip and code highlight', (await tip()) === '' && (await cmMarks()) === '', (await tip()) + ' / ' + await cmMarks());
await page.click('.ftab[data-tab="basys3.xdc"]'); await page.waitForTimeout(100);
await page.locator('#board .b-led').nth(3).hover(); await page.waitForTimeout(120);
check('with the xdc open, hovering led3 highlights its xdc line', /led\[3\]|V19/.test(await cmMarks()), await cmMarks());
await page.mouse.move(640, 20); await page.waitForTimeout(100);

console.log('== hover code → board');
await page.click('.ftab[data-tab="design.sv"]'); await page.waitForTimeout(100);
let w = await wordAt('design.sv', 'led', 0);
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('hovering `led` in the top header highlights all 16 leds', (await page.locator('#board .b-led.hl').count()) === 16, String(await page.locator('#board .b-led.hl').count()));
w = await wordAt('design.sv', 'btnC', 1);
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('hovering `btnC` in the body highlights the btnC button only', (await hl()) === 'btnC', await hl());
w = await wordAt('design.sv', 'sw[1]', 0);
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('hovering `sw[1]` highlights only sw1', (await hl()) === '1', await hl());
w = await wordAt('design.sv', 'led', 6);   // 6th occurrence = module helper's own `led` port (0 header, 1-3 body, 4 `.led(`, 5 led[7:4])
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('`led` inside module helper (not the top) highlights nothing', (await hl()) === '', await hl());
w = await wordAt('design.sv', 'led', 4);   // `.led(` in the top's body names helper's port, not the top's led
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('`.led(` in a named connection inside the top highlights nothing', (await hl()) === '', await hl());
await page.mouse.move(640, 20); await page.waitForTimeout(150);
check('leaving the editor clears the board highlight', (await hl()) === '', await hl());
await page.click('.ftab[data-tab="basys3.xdc"]'); await page.waitForTimeout(100);
w = await wordAt('basys3.xdc', 'led[3]', 0);
await page.mouse.move(w.x, w.y); await page.waitForTimeout(150);
check('hovering led[3] in the xdc highlights led3', (await hl()) === '3' || (await page.locator('#board .b-led.hl').count()) === 1, await hl());
await page.mouse.move(640, 20); await page.waitForTimeout(100);
await page.click('.ftab[data-tab="design.sv"]');

console.log('== DONE vs POWER: edit, in-flight, failed run; stale mapping must not show');
await setFile('design.sv', DESIGN + '\n// edited\n');
await page.waitForTimeout(100);
check('after an edit: DONE off, POWER on, status asks for run', !(await done()) && (await power()) && /press run/.test(await status()), await status());
check('after an edit: no port labels, no stale mapping', (await labels()) === 0, String(await labels()));
await page.locator('#board .b-led').nth(1).hover(); await page.waitForTimeout(100);
check('after an edit: hovering the board shows no stale name/pin', (await tip()) === '', await tip());
w = await wordAt('design.sv', 'led', 0); await page.mouse.move(w.x, w.y); await page.waitForTimeout(100);
check('after an edit: hovering code lights nothing on the board', (await hl()) === '', await hl());
await page.mouse.move(640, 20);
await page.click('#run'); await page.waitForTimeout(30);
check('in flight: DONE off, no circuit', !(await done()) && (await page.evaluate(() => !window.dewfpga.sim)));
await waitIdle(); await waitStatus(/simulated clock/);
check('after the run: DONE on and labels back', (await done()) && (await labels()) > 0);
await setFile('design.sv', DESIGN.replace('endmodule\nmodule helper', 'endmodul\nmodule helper'));
await runAndWait(/not running/);
check('failed run: DONE off, POWER still on', !(await done()) && (await power()), await status());
check('failed run: all leds cleared (no on, no x)', (await page.locator('#board .b-led.on, #board .b-led.x').count()) === 0, String(await page.locator('#board .b-led.on, #board .b-led.x').count()));
check('failed run: no labels', (await labels()) === 0, String(await labels()));
await setFile('basys3.xdc', xdc0);   // btnC loses its pin → xdc binding error
await setFile('design.sv', DESIGN);
await runAndWait(/not running|simulated clock/);
check('port without a pin: not running, DONE off', /every port needs a pin/.test(await status()) && !(await done()), await status());
await page.locator('#board .b-led').nth(1).hover(); await page.waitForTimeout(100);
check('port without a pin: board hover still names the pin that is bound (led[1] E19)', /led\[1\]/.test(await tip()), await tip());
await page.mouse.move(640, 20);
await page.screenshot({ path: S + '/board-desktop.png' });

console.log('== timing advice: opens for new hints, stays closed after the student closes it');
const slow = (bit) => `module blink(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n  logic [${bit}:0] c = 0;\n  always_ff @(posedge clk) c <= c + 1;\n  assign led = {15'b0, c[${bit}]};\nendmodule\n`;
const panelOpen = () => page.locator('#timing-help').evaluate((e) => !e.hidden && e.open);
await setFile('design.sv', slow(26));
await runAndWait(/simulated clock/);
check('a slow counter opens the timing panel', await panelOpen());
await page.locator('#timing-help > summary').click(); await page.waitForTimeout(80);
await runAndWait(/simulated clock/);
check('closed, then run again with the same advice: stays closed', !(await panelOpen()));
await page.click('#view-tb'); await page.waitForTimeout(300); await page.click('#view-board'); await waitStatus(/simulated clock/); await waitIdle(); await page.waitForTimeout(150);
check('closed, then testbench view and back: stays closed', !(await panelOpen()));
await setFile('design.sv', slow(27));
await runAndWait(/simulated clock/);
check('different advice (bit 27) opens it again', await panelOpen());
await setFile('design.sv', DESIGN);

console.log('== mobile viewport: touch toggles a switch, holds a button, tap shows the name');
const mctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
page = await mctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror(mobile): ' + e.message));
await page.goto(BASE); await waitStatus(/simulated clock|combinational|error|not running/); await waitIdle(); await page.waitForTimeout(200);
await setFile('design.sv', DESIGN);
await setFile('basys3.xdc', xdc0 + '\nset_property -dict { PACKAGE_PIN U18 IOSTANDARD LVCMOS33 } [get_ports { btnC }]\n');
await runAndWait(/simulated clock/);
const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
check('no horizontal overflow at 390', m.sw <= m.iw, JSON.stringify(m));
await page.locator('#board').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);   // the board sits below the editor on a phone
const hit = await page.locator('#board .b-sw[data-sw="2"]').boundingBox();
check('switch hit target at 390 spans the whole column pitch (>= 17 px, 54 board units)', hit && hit.width >= 17, JSON.stringify(hit));
const s2 = await center('#board .b-sw[data-sw="2"]');
await page.touchscreen.tap(s2.x, s2.y); await page.waitForTimeout(150);
check('tap toggles sw2 on', (await swState())[2] === 1, JSON.stringify((await swState()).slice(0, 4)));
await page.touchscreen.tap(s2.x, s2.y); await page.waitForTimeout(150);
check('second tap toggles sw2 off', (await swState())[2] === 0, JSON.stringify((await swState()).slice(0, 4)));
const b2 = await center('#board .b-btn[data-btn=btnC]');
// playwright can hold a trusted touch only through chromium's CDP; elsewhere a synthetic touch pointer drives the same handlers
const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null, how = cdp ? 'cdp touch' : 'synthetic touch pointer';
const touchPtr = (type) => page.locator('#board .b-btn[data-btn=btnC]').dispatchEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: b2.x, clientY: b2.y, bubbles: true, cancelable: true });
if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b2.x, y: b2.y }] }); else await touchPtr('pointerdown');
await page.waitForTimeout(120);
check(`touch hold (${how}): btnC=1 led0 on`, (await btnState()).btnC === 1 && (await ledClass(0)).includes('on'), JSON.stringify(await btnState()));
if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); else await touchPtr('pointercancel');
await page.waitForTimeout(120);
check(`touch cancel (${how}): btnC=0 led0 off`, (await btnState()).btnC === 0 && !(await ledClass(0)).includes('on'), JSON.stringify(await btnState()));
await page.locator('#board .b-ledg[data-led="15"]').focus(); await page.waitForTimeout(100);   // the focusable element is the led group
check('focusing led15 (keyboard / assistive) shows its name and pin', /led\[15\]/.test(await tip()), await tip());
const outside = await page.evaluate(() => {
  const vw = document.documentElement.clientWidth, bad = [];
  for (const g of document.querySelectorAll('#board .b-sw, #board .b-ledg, #board .b-btn')) {
    g.focus(); const t = document.querySelector('#board-tip').getBoundingClientRect();
    if (t.width === 0 || t.left < 0 || t.right > vw || t.top < 0) bad.push(`${g.getAttribute('aria-label')} [${Math.round(t.left)},${Math.round(t.top)},${Math.round(t.right)}]`);
    g.blur();
  }
  return bad;
});
check('at 390 every switch, led and button tooltip is fully on screen', outside.length === 0, outside.join(' | '));
await page.screenshot({ path: S + '/board-mobile.png' });
} catch (e) {
  fail++;
  console.log(`  FAIL (step threw) ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: S + '/board-failed.png' }).catch(() => {});
}
console.log(`\npassed ${pass}, failed ${fail}`);
console.log('page errors:', errs.length ? errs : 'none');
await browser.close();
process.exit(fail || errs.length ? 1 : 0);
