// The actual built workers on two engine defects: the wrapped copy of a .v file used to be written to
// <name>.slang.v, which could be a real source, and the hardware check used to read synth_xilinx's cell
// library in the frontend that still held the sources (a unit-scope enum item S0 or a user module named
// INV collided with it). Every accepted design is then driven in the real page's DigitalJS and its exported
// netlist runs under a testbench in native iverilog; the controls show the hardware checks still reject.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url)), tmp = mkdtempSync(join(tmpdir(), 'dewfpga-engine-isolation-'));
const sv = (n) => readFileSync(join(root, '../test/sv', n, 'design.sv'), 'utf8');
const exec = (args) => { const r = spawnSync(args[0], args.slice(1), { cwd: tmp, encoding: 'utf8', timeout: 30000, env: { ...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' } }); assert.equal(r.status, 0, `${args[0]}: ${r.error || ''}\n${r.stdout}\n${r.stderr}`); return r.stdout; };
const cellTypes = (json) => Object.values(JSON.parse(json).modules.top.cells || {}).map((c) => c.type).sort();
const codes = (r) => (r.diags || []).map((d) => `${d.kind}:${d.text}`);
const has = (r, code) => (r.diags || []).some((d) => d.text.includes(`[${code}]`));

// one inverter in Verilog-2005 (`bit` is only a word there) and one plain wire, under names that collide
// with the old wrapper name; the top needs yosys-slang (function return), so the wrapper is really built
const INV_A = 'module inv_a(input a, output y); reg bit; assign y = ~a; endmodule\n';
const INV_B = 'module inv_b(input a, output y); assign y = a; endmodule\n';
const TOP = 'module top(input [15:0] sw, output [15:0] led);\n  function automatic logic [3:0] maxn(input logic [3:0] a, input logic [3:0] b);\n    if (a > b) return a;\n    return b;\n  endfunction\n  inv_a u0(.a(sw[0]), .y(led[0]));\n  inv_b u1(.a(sw[1]), .y(led[1]));\n  assign led[5:2] = maxn(sw[5:2], sw[9:6]);\n  assign led[15:6] = \'0;\nendmodule\n';
const maxTop = (s) => ((~s & 1) | (s & 2) | (Math.max((s >> 2) & 15, (s >> 6) & 15) << 2));
const INV = 'module INV(input logic a, output logic y); assign y = ~a; endmodule\n';
const TB_SW = (expect) => `module tb; reg [15:0] sw = 0; wire [15:0] led; top dut(.sw(sw), .led(led)); integer i, bad = 0;\ninitial begin for (i = 0; i < 256; i++) begin sw = i | (i << 8); #1 if (led !== (${expect})) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end end\nif (bad == 0) $display("PASS"); else $display("FAIL: %0d of 256", bad); $finish; end endmodule\n`;

await build({ root, logLevel: 'error' });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const asset = readdirSync(join(root, 'dist/assets')).find((n) => /^yosys\.worker-.*\.js$/.test(n));
  const tbAsset = readdirSync(join(root, 'dist/assets')).find((n) => /^tb\.worker-.*\.js$/.test(n));
  assert.ok(asset && tbAsset, 'built workers');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('dialog', (d) => d.accept()); page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/'); await page.waitForFunction(() => window.dewfpga?.sim, null, { timeout: 120000 });
  await page.evaluate(([url, tburl]) => {
    const worker = new Worker(url, { type: 'module' }); let id = 0;
    window.compile = (files, extra = {}) => new Promise((resolve, reject) => {
      const request = ++id; const timer = setTimeout(() => reject(new Error('worker exceeded 180 seconds')), 180000);
      const done = (e) => { if (e.data.id === request) { clearTimeout(timer); worker.removeEventListener('message', done); resolve(e.data); } };
      worker.addEventListener('message', done); worker.postMessage({ id: request, kind: 'compile', files, extra, top: 'top' });
    });
    const tb = new Worker(tburl, { type: 'module' }); let tid = 0;
    window.testbench = (files) => new Promise((resolve, reject) => {
      const request = ++tid; const timer = setTimeout(() => reject(new Error('icarus exceeded 60 seconds')), 60000);
      const done = (e) => { if (e.data.id === request) { clearTimeout(timer); tb.removeEventListener('message', done); resolve(e.data); } };
      tb.addEventListener('message', done); tb.postMessage({ id: request, files, extra: {}, top: 'tb' });
    });
  }, [base + '/assets/' + asset, base + '/assets/' + tbAsset]);
  const compile = (files, extra) => page.evaluate(([f, x]) => window.compile(f, x), [files, extra || {}]);

  // the exported netlist under a testbench in native iverilog: the circuit the browser built, judged outside it
  const native = (name, json, tb) => {
    writeFileSync(join(tmp, 'net.json'), json); writeFileSync(join(tmp, 'tb.sv'), tb);
    exec(['yosys', '-Q', '-q', '-p', 'read_json net.json; hierarchy -top top; flatten; write_verilog -noattr net.v']);
    exec(['iverilog', '-g2012', '-s', 'tb', '-o', 'run.vvp', 'net.v', 'tb.sv']);
    const out = exec(['vvp', '-n', 'run.vvp']);
    assert.ok(/\bPASS\b/.test(out) && !/\bFAIL\b/.test(out), `${name}: native iverilog on the worker netlist\n${out}`);
    console.log(`PASS ${name}: worker netlist passes its testbench in native iverilog`);
  };
  // the same files through the real page: import, wait for the run, drive the page's own DigitalJS
  const xdc = readFileSync(join(root, '../templates/blink.xdc'), 'utf8') + '\nset_property PACKAGE_PIN U18 [get_ports btnC]\nset_property IOSTANDARD LVCMOS33 [get_ports btnC]\n';
  const inPage = async (name, files, drive) => {
    await page.evaluate(({ files, xdc }) => window.dewfpga.importRecords([...Object.entries(files).map(([path, text]) => ({ path, text })), { path: 'pins.xdc', text: xdc }], 'engine isolation'), { files, xdc });
    await page.waitForFunction(() => window.dewfpga.pendingRequests === 0 && (window.dewfpga.sim?.top === 'top' || document.querySelector('#status').textContent.includes('not running')), null, { timeout: 120000 });
    assert.equal(await page.evaluate(() => window.dewfpga.sim?.top), 'top', `${name}: ${await page.locator('#console').innerText()}`);
    if (drive.clock) await page.click('#pause');
    const n = await page.evaluate((drive) => {
      const sim = window.dewfpga.sim;
      const set = (port, value, bits) => { for (let b = 0; b < bits; b++) sim.setBit(port, b, (value >> b) & 1); sim.settle(); };
      const led = () => { let n = 0; for (let b = 0; b < 16; b++) { const v = sim.outBit('led', b); if (v !== -1 && v !== 1) throw Error(`unknown led[${b}]`); if (v === 1) n += 2 ** b; } return n; };
      const expect = new Function('s', 'i', `return ${drive.expect};`);
      if (drive.clock) {
        set('btnC', 1, 1); sim.cycle('clk'); set('btnC', 0, 1);
        for (let i = 0; i < drive.count; i++) { const want = expect(0, i), got = led(); if (got !== want) throw Error(`step ${i}: led ${got}, expected ${want}`); sim.cycle('clk'); }
        return drive.count;
      }
      for (let i = 0; i < drive.count; i++) { const s = i | (i << 8); set('sw', s, 16); const want = expect(s, i), got = led(); if (got !== want) throw Error(`sw ${s}: led ${got}, expected ${want}`); }
      return drive.count;
    }, drive);
    console.log(`PASS ${name}: the page's DigitalJS, ${n} output comparisons`);
  };

  // 1. a real source under the old wrapper name: both files are read, the wrapper is still a 2005 wrapper
  const collision = { 'foo.v': INV_A, 'foo.v.slang.v': INV_B, 'top.sv': TOP };
  let r = await compile(collision);
  assert.equal(r.ok, true, `collision: ${codes(r)}`);
  assert.equal(r.reader, 'slang', 'collision: the top needs yosys-slang');
  assert.ok(has(r, 'read-with-slang'), `collision: ${codes(r)}`);
  assert.deepEqual(cellTypes(r.json).filter((t) => t === '$not'), ['$not'], `collision: one inverter from foo.v, a wire from foo.v.slang.v: ${cellTypes(r.json)}`);
  console.log(`PASS collision: foo.v and foo.v.slang.v both read (${cellTypes(r.json).join(' ')})`);
  native('collision', r.json, TB_SW('{10\'b0, (sw[5:2] > sw[9:6] ? sw[5:2] : sw[9:6]), sw[1], ~sw[0]}'));
  await inPage('collision', collision, { count: 256, expect: `(${maxTop.toString()})(s)` });
  r = await page.evaluate((f) => window.testbench(f), { 'foo.v': INV_A, 'foo.v.slang.v': INV_B, 'tb.sv': 'module tb; reg a = 1; wire y0, y1; inv_a u0(.a(a), .y(y0)); inv_b u1(.a(a), .y(y1)); initial begin #1; if (y0 !== 0 || y1 !== 1) $fatal(1, "wrong y0=%b y1=%b", y0, y1); $display("PASS y0=%b y1=%b", y0, y1); $finish; end endmodule\n' });
  assert.equal(r.ok, true, `collision testbench: ${JSON.stringify(r.log)}`);
  assert.ok((r.out || []).some((l) => /PASS y0=0 y1=1/.test(l)), `collision testbench: ${JSON.stringify(r.out)}`);
  console.log('PASS collision: the testbench worker reads both files too');

  // 2. user paths that spell the scratch names: a folder named like a result file, a file named like the wrapper
  const scratchy = { 'out.json/top.sv': TOP, '.dewfpga.args/foo.v': INV_A, '.dewfpga.0.v': INV_B };
  r = await compile(scratchy, { 'preflight.json/notes.mem': '0\n' });
  assert.equal(r.ok, true, `scratch-named paths: ${codes(r)}`);
  assert.equal(r.reader, 'slang');
  assert.deepEqual(cellTypes(r.json).filter((t) => t === '$not'), ['$not'], `scratch-named paths: ${cellTypes(r.json)}`);
  native('scratch-named paths', r.json, TB_SW('{10\'b0, (sw[5:2] > sw[9:6] ? sw[5:2] : sw[9:6]), sw[1], ~sw[0]}'));
  console.log('PASS scratch-named paths: out.json/, .dewfpga.args/, .dewfpga.0.v all stay user files');

  // 3. the hardware check reads rtlil, not the sources, so the cell library meets no user name
  const enumDesign = { 'design.sv': sv('56_unit_scope_enum') };
  r = await compile(enumDesign);
  assert.equal(r.ok, true, `56 unit-scope enum: ${codes(r)}`);
  assert.equal(r.reader, 'yosys', '56: yosys\' own reader, no second reader needed');
  assert.ok(!r.diags.some((d) => d.kind !== 'text'), `56: no diagnostics expected: ${codes(r)}`);
  console.log(`PASS 56 unit-scope enum: accepted by yosys' reader (${cellTypes(r.json).join(' ')})`);
  native('56 unit-scope enum', r.json, readFileSync(join(root, '../test/sv/56_unit_scope_enum/tb.sv'), 'utf8'));
  await inPage('56 unit-scope enum', enumDesign, { clock: true, count: 9, expect: 'i % 3' });

  // 4. a user module named INV: yosys' reader keeps it as a real module in rtlil, so the library clash is
  // real; as the command line, the design is rebuilt with yosys-slang, which elaborates it away
  const invDesign = { 'design.sv': sv('98_module_named_primitive') };
  r = await compile(invDesign);
  assert.equal(r.ok, true, `98 module named INV: ${codes(r)}`);
  assert.equal(r.reader, 'slang', '98: rebuilt with yosys-slang after the library clash');
  assert.ok(has(r, 'read-with-slang'), `98: ${codes(r)}`);
  assert.deepEqual(cellTypes(r.json), ['$not'], `98: ${cellTypes(r.json)}`);
  console.log('PASS 98 module named INV: accepted after the slang rebuild');
  native('98 module named INV', r.json, readFileSync(join(root, '../test/sv/98_module_named_primitive/tb.sv'), 'utf8'));
  await inPage('98 module named INV', invDesign, { count: 256, expect: '(s & 0xfffe) | (~s & 1)' });

  // 5. controls: the rebuild does not loosen the hardware checks
  r = await compile({ 'design.sv': sv('03_async_reset_nonconst') });
  assert.equal(r.ok, false); assert.ok(has(r, 'async-reset-nonconst'), codes(r));
  console.log('PASS control: non-constant async reset still rejected');
  r = await compile({ 'design.sv': INV + 'module top(input clk, input rst, input d, output reg q, output y);\nINV u0(.a(d), .y(y));\n`ifdef SIM\nalways @(posedge clk) q <= d;\n`else\nalways @(posedge clk or posedge rst) if(rst) q <= d; else q <= ~q;\n`endif\nendmodule\n' });
  assert.equal(r.ok, false, `INV + hidden hardware: ${codes(r)}`); assert.ok(has(r, 'async-reset-nonconst') && !has(r, 'read-with-slang'), codes(r));
  assert.ok(r.diags.some((d) => d.kind === 'error' && d.file === 'design.sv' && d.line > 0), `source location: ${codes(r)}`);
  console.log('PASS control: INV + hardware hidden from SIM rejected before any rebuild, with its source line');
  r = await compile({ 'design.sv': INV + 'module top(input [15:0] sw, output [15:0] led);\nINV u0(.a(sw[0]), .y(led[0]));\nassign led[0] = sw[1];\nassign led[15:1] = sw[15:1];\nendmodule\n' });
  assert.equal(r.ok, false, `INV + two drivers: ${codes(r)}`); assert.ok((has(r, 'two-assign-drivers') || has(r, 'multiple-drivers')) && !has(r, 'read-with-slang'), codes(r));
  console.log('PASS control: INV + two drivers rejected with the driver code, not rebuilt');
  r = await compile({ 'design.sv': INV + 'module top(input [15:0] sw, output reg [15:0] led);\nwire y; INV u0(.a(sw[0]), .y(y));\nalways @* if (sw[1]) led = {15\'b0, y};\nendmodule\n' });
  assert.equal(r.ok, true, `INV + latch: ${codes(r)}`); assert.ok(has(r, 'latch') && has(r, 'read-with-slang'), codes(r));
  console.log('PASS control: INV + latch accepted with the latch warning after the rebuild');

  assert.deepEqual(errors, [], 'page errors');
  console.log('engine isolation: collision, scratch-named paths, 56, 98 accepted and behaving; 4 controls; no page errors');
} finally { if (browser) await browser.close(); await server.close(); rmSync(tmp, { recursive: true, force: true }); }
