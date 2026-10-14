// a design with no lab names and ports declared [4:1], [1:4], [-2:-1], [0:0], [3:3] and scalar, read by the real
// yosys worker and run in the real page's DigitalJS: every switch the XDC names drives the source bit it names,
// every LED shows the source bit it names. expected LEDs come from a truth table over source indices, not from the
// engine. real switch clicks light the LED elements; labels, aria, tooltip and code <-> board hover name the source
// index. a second design with different logic must light different LEDs; a missing, a doubled and a shared pin must
// each stop the run.
// run by test/run-e2e.mjs against its preview (BASE); alone, it builds and previews by itself.
//   BROWSER (chromium|webkit|firefox), E2E_EXECUTABLE as in test/e2e.mjs
import { build, preview } from 'vite';
import { chromium, webkit, firefox } from 'playwright';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));

const design = (op) => `module knobs(input logic [4:1] knob, input logic [1:4] dial, input logic [-2:-1] neg,
  input logic [0:0] one, input logic [3:3] three, input logic s,
  output logic [6:3] lamp, output logic [-1:0] nl, output logic z);
  assign lamp = knob ${op} dial;
  assign nl = neg;
  assign z = one[0] & three[3] & s;
endmodule
`;
const pin = (p, port) => `set_property -dict { PACKAGE_PIN ${p} IOSTANDARD LVCMOS33 } [get_ports {${port}}]`;
// switch k and led k of the board: source name -> pin
const SW = ['V17', 'V16', 'W16', 'W17', 'W15', 'V15', 'W14', 'W13', 'V2', 'T3', 'T2', 'R3', 'W2'];
const LED = ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14'];
const swNames = ['knob[1]', 'knob[2]', 'knob[3]', 'knob[4]', 'dial[1]', 'dial[2]', 'dial[3]', 'dial[4]', 'neg[-2]', 'neg[-1]', 'one[0]', 'three[3]', 's'];
const ledNames = ['lamp[3]', 'lamp[4]', 'lamp[5]', 'lamp[6]', 'nl[-1]', 'nl[0]', 'z'];
const XDC = [...swNames.map((n, k) => pin(SW[k], n)), ...ledNames.map((n, k) => pin(LED[k], n))].join('\n') + '\n';

// truth table by source index. positional assignment: lamp[6:3] = knob[4:1] op dial[1:4] pairs lamp[6]-knob[4]-dial[1]
// ... lamp[3]-knob[1]-dial[4]; nl[-1:0] = neg[-2:-1] pairs nl[-1]-neg[-2], nl[0]-neg[-1]
function expect(sw, op) {
  const v = Object.fromEntries(swNames.map((n, k) => [n, (sw >> k) & 1]));
  const f = op === '^' ? (a, b) => a ^ b : (a, b) => a & b;
  const out = {};
  for (let j = 0; j < 4; j++) out[`lamp[${6 - j}]`] = f(v[`knob[${4 - j}]`], v[`dial[${1 + j}]`]);
  out['nl[-1]'] = v['neg[-2]']; out['nl[0]'] = v['neg[-1]'];
  out.z = v['one[0]'] & v['three[3]'] & v.s;
  return ledNames.map((n) => out[n]);
}
const vectors = [0, 1, 0b1000, 0b10000, 0b10000000, 0b1001, 0b10010001, 0x100, 0x200, 0x1c00, 0x0c00, 0x1fff];
for (let k = 0; k < 20; k++) vectors.push((k * 2654435761) >>> 19 & 0x1fff);

const browserName = process.env.BROWSER || 'chromium';
const type = { chromium, webkit, firefox }[browserName];
if (!type) throw new Error(`unsupported BROWSER=${browserName}`);
const launch = { headless: !process.env.E2E_HEADED };
if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
let server = null, browser;
if (!process.env.BASE) {
  await build({ root, logLevel: 'error' });
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
}
try {
  const base = process.env.BASE || `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await type.launch(launch);
  console.log(`browser ${browserName} ${browser.version()}  base ${base}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', (d) => d.accept());
  await page.goto(base);
  await page.waitForFunction(() => window.dewfpga && window.dewfpga.pendingRequests === 0 && /simulated clock|combinational|not running|error/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  // the page's whole path: files -> run button -> yosys worker -> Sim -> parseXdc/bindPorts; a board switch click
  // (board.toggleSwitch -> main.js onBoardInput -> setBit) and the page's led paint (outBit -> board.setLed)
  const run = async (src, xdc, sws) => {
    await page.evaluate(([s, x]) => { window.dewfpga.setView('board'); window.dewfpga.files.set('design.sv', s); window.dewfpga.files.set('basys3.xdc', x); }, [src, xdc]);
    await page.evaluate(() => { document.querySelector('#status').textContent = ''; });
    await page.click('#run');
    await page.waitForFunction(() => window.dewfpga.pendingRequests === 0 && /combinational|simulated clock|not running/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
    return page.evaluate((sws) => {
      const d = window.dewfpga, b = d.binding;
      const result = { status: document.querySelector('#status').textContent, console: document.querySelector('#console') ? document.querySelector('#console').textContent : '', ports: d.sim ? d.sim.ports() : null, errors: [], leds: [] };
      if (!b) { result.errors = [...document.querySelectorAll('#console *')].filter((e) => !e.children.length).map((e) => e.textContent).filter((t) => t.startsWith('xdc: ')).map((t) => t.slice(5)); return result; }
      for (const s of sws) {
        for (let k = 0; k < 13; k++) if (d.board.state.sw[k] !== ((s >> k) & 1)) d.board.toggleSwitch(k);
        result.leds.push([0, 1, 2, 3, 4, 5, 6].map((i) => (d.board.led[i] === 1 ? 1 : d.board.led[i] === -1 ? 0 : 'x')));
      }
      for (let k = 0; k < 16; k++) if (d.board.state.sw[k]) d.board.toggleSwitch(k);
      return result;
    }, sws);
  };

  const xor = await run(design('^'), XDC, vectors);
  console.log('ports', JSON.stringify(xor.ports));
  assert.match(xor.status, /combinational/, `xor run: ${xor.status}\n${xor.console}`);
  vectors.forEach((s, i) => assert.deepEqual(xor.leds[i], expect(s, '^'), `xor sw=${s.toString(2)}`));
  console.log(`ok xor: ${vectors.length} switch vectors match the truth table`);

  // the same xor circuit through the page's own DOM: switch clicks, LED classes, silkscreen labels, aria, tooltip
  const ledOn = () => page.evaluate(() => [...document.querySelectorAll('#board .b-led')].slice(0, 7).map((e) => (e.classList.contains('on') ? 1 : 0)));
  const click = async (k) => { await page.locator(`#board .b-sw[data-sw="${k}"]`).click(); await page.waitForTimeout(80); };
  let sw = 0;
  for (const k of [8, 4, 10, 11, 12, 3]) {
    await click(k); sw ^= 1 << k;
    assert.deepEqual(await ledOn(), expect(sw, '^'), `dom click sw${k} (${swNames[k]}), sw=${sw.toString(2)}`);
  }
  await click(12); sw ^= 1 << 12;
  assert.deepEqual(await ledOn(), expect(sw, '^'), 'dom click s off turns z off');
  for (let k = 0; k < 13; k++) if ((sw >> k) & 1) await click(k);
  console.log('ok dom: switch clicks light the LED elements the truth table names');
  const labels = await page.evaluate(() => [...document.querySelectorAll('#board .b-labels .b-port')].map((e) => e.textContent).sort());
  assert.deepEqual(labels, [...swNames, ...ledNames].sort(), 'silkscreen labels name source indices');
  const aria = await page.evaluate(() => [document.querySelector('#board .b-sw[data-sw="4"]').getAttribute('aria-label'), document.querySelector('#board .b-ledg[data-led="4"]').getAttribute('aria-label'), document.querySelector('#board .b-sw[data-sw="10"]').getAttribute('aria-label'), document.querySelector('#board .b-sw[data-sw="12"]').getAttribute('aria-label')]);
  assert.deepEqual(aria, ['switch SW4 · dial[1] · pin W15', 'led LD4 · nl[-1] · pin W18', 'switch SW10 · one[0] · pin T2', 'switch SW12 · s · pin W2']);
  const tip = async (sel) => { await page.locator(sel).hover(); await page.waitForTimeout(120); return page.evaluate(() => { const t = document.querySelector('#board-tip, .b-tip'); return t && !t.hidden ? t.textContent : ''; }); };
  assert.match(await tip('#board .b-sw[data-sw="11"]'), /^three\[3\] · pin R3 /);
  assert.match(await tip('#board .b-sw[data-sw="8"]'), /^neg\[-2\] · pin V2 /);
  console.log('ok labels: silkscreen, aria and tooltip name knob[4]..dial[1]..neg[-2]..one[0]..three[3]..s by source index');

  // board -> code: hovering a switch marks its pin line in the xdc
  const marks = () => page.evaluate(() => [...document.querySelectorAll('#editors .editor:not([hidden]) .cm-board-hl')].map((e) => e.textContent).join('|'));
  await page.evaluate(() => window.dewfpga.files.show('basys3.xdc')); await page.waitForTimeout(150);
  await tip('#board .b-sw[data-sw="9"]');
  assert.equal(await marks(), pin('T3', 'neg[-1]'), 'hover sw9 marks the neg[-1] line');
  await tip('#board .b-sw[data-sw="4"]');
  assert.equal(await marks(), pin('W15', 'dial[1]'), 'hover sw4 marks the dial[1] line');
  // code -> board: hovering a port name on an xdc line, or `three[3]` in the design, lights that one switch
  const hl = () => page.evaluate(() => [...document.querySelectorAll('#board .hl')].map((e) => e.getAttribute('data-sw') ?? e.getAttribute('data-led') ?? e.getAttribute('class')).join(','));
  const hoverWord = async (file, word, after) => {
    await page.click(`.ftab[data-tab="${file}"]`); await page.waitForTimeout(100);
    // as board-e2e's wordAt: scroll the line into the editor's box first, CodeMirror renders only visible lines
    const i = await page.evaluate(([f, w, a]) => { const v = window.dewfpga.files.get(f).view, t = v.state.doc.toString(), i = t.indexOf(w, t.indexOf(a)); const box = v.dom.closest('.editor') || v.scrollDOM; box.scrollTop = Math.max(0, v.lineBlockAt(i).top - 40); v.requestMeasure(); return i; }, [file, word, after]);
    await page.waitForTimeout(120);
    const c = await page.evaluate(([f, i]) => { const r = window.dewfpga.files.get(f).view.coordsAtPos(i + 1); return r && { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, [file, i]);
    await page.mouse.move(c.x, c.y); await page.waitForTimeout(150);
    return hl();
  };
  assert.equal(await hoverWord('basys3.xdc', 'neg', 'neg[-1]'), '9', 'hover neg on the neg[-1] xdc line lights sw9');
  assert.equal(await hoverWord('basys3.xdc', 'dial', 'dial[1]'), '4', 'hover dial on the dial[1] xdc line lights sw4');
  assert.equal(await hoverWord('design.sv', 'three', 'assign z'), '11', 'hover three[3] in the design lights sw11');
  await page.mouse.move(640, 20);
  console.log('ok hover: board -> xdc line and xdc line / three[3] -> board use source indices');

  const and = await run(design('&'), XDC, vectors);
  assert.match(and.status, /combinational/, `and run: ${and.status}\n${and.console}`);
  vectors.forEach((s, i) => assert.deepEqual(and.leds[i], expect(s, '&'), `and sw=${s.toString(2)}`));
  assert.ok(vectors.some((_, i) => JSON.stringify(and.leds[i]) !== JSON.stringify(xor.leds[i])), 'changed logic changes the LEDs');
  console.log('ok and: matches its own truth table and differs from xor');

  const bareVector = await run(design('^'), XDC.replace(pin('T2', 'one[0]'), pin('T2', 'one')), []);
  assert.ok(bareVector.errors.includes('port one[0] has no PACKAGE_PIN in the xdc'), JSON.stringify(bareVector.errors));
  console.log('ok one-bit vector: preserved [0:0] metadata requires [0], matching the CLI');

  const missing = await run(design('^'), XDC.replace(pin('U19', 'lamp[5]') + '\n', ''), []);
  assert.deepEqual(missing.errors, ['port lamp[5] has no PACKAGE_PIN in the xdc']);
  const missingNeg = await run(design('^'), XDC.replace(pin('T3', 'neg[-1]') + '\n', ''), []);
  assert.deepEqual(missingNeg.errors, ['port neg[-1] has no PACKAGE_PIN in the xdc']);
  const doubled = await run(design('^'), XDC + pin('V14', 'lamp[4]') + '\n', []);
  assert.ok(doubled.errors.some((e) => /lamp\[4\].*E19.*V14|lamp\[4\].*V14.*E19/.test(e)), `doubled: ${JSON.stringify(doubled.errors)}`);
  const shared = await run(design('^'), XDC.replace(pin('W18', 'nl[-1]'), pin('U16', 'nl[-1]')), []);
  assert.ok(shared.errors.some((e) => /U16/.test(e) && /lamp\[3\]/.test(e) && /nl\[-1\]/.test(e)), `shared: ${JSON.stringify(shared.errors)}`);
  console.log('ok negatives: missing, missing negative index, doubled and shared pins each stop the run');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
}
