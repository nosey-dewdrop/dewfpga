// one workspace, two views. the files are the same three the command line works on:
// design.sv (+ any other .sv), tb.sv, basys3.xdc.
//   board:     yosys (wasm) synthesizes design.sv + friends, digitaljs drives the virtual basys3
//   testbench: icarus verilog (wasm) compiles everything including tb.sv, runs it, draws the vcd
import { Files } from './files.js';
import { Board } from './board.js';
import { Sim } from './engine.js';
import { parseXdc, bindPorts } from './xdc.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import { parseVcd } from '../tb/vcd.js';
import { Wave } from '../tb/wave.js';
import { compressToEncodedURIComponent as enc, decompressFromEncodedURIComponent as dec } from 'lz-string';
import '../site.js';

const $ = (s) => document.querySelector(s);
const consoleEl = $('#console'), consoleLabel = $('#console-label'), statusEl = $('#status'), runBtn = $('#run');
const speedEl = $('#speed'), speedLabel = $('#speed-label'), svg = $('#board'), outEl = $('#out');
const TB = 'tb.sv', XDC = 'basys3.xdc';
const STUB_TB = `// a testbench for your design. instantiate the top module, drive its inputs, $display what you see.
\`timescale 1ns/1ps
module tb;
  // top dut(.clk(clk), ...);
  initial begin
    $dumpfile("wave.vcd"); $dumpvars(0, tb);
    #100;
    $finish;
  end
endmodule
`;

// ---- workers ----------------------------------------------------------
let yosysW = null, tbW = null, reqId = 0;
const pending = new Map();
function spawnYosys() {
  yosysW = new Worker(new URL('./yosys.worker.js', import.meta.url), { type: 'module' });
  yosysW.onmessage = (e) => {
    if (e.data.kind === 'progress') { const { done, total } = e.data; if (total && view === 'board') setStatus(`downloading yosys · ${(done / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} mb · once, then cached`); return; }
    settle(e.data);
  };
}
function spawnTb() {
  tbW = new Worker(new URL('../tb/tb.worker.js', import.meta.url), { type: 'module' });
  tbW.onmessage = (e) => settle(e.data);
}
function settle(data) { const p = pending.get(data.id); if (p) { clearTimeout(p.timer); pending.delete(data.id); p.res(data); } }
function ask(which, msg, ms, onTimeout) {
  return new Promise((res) => {
    const id = ++reqId;
    const timer = setTimeout(() => {
      pending.delete(id);
      if (which === 'yosys') { yosysW.terminate(); spawnYosys(); } else { tbW.terminate(); spawnTb(); }
      res(onTimeout(id));
    }, ms);
    pending.set(id, { res, timer });
    (which === 'yosys' ? yosysW : tbW).postMessage({ id, ...msg });
  });
}
spawnYosys(); spawnTb();

// ---- files ------------------------------------------------------------
const DRAFT = 'dewfpga.draft';
function normalize(o) {
  // accepts every shape ever put in a link or a draft:
  //   new:        {files: {design.sv, ..., tb.sv}, xdc}
  //   old board:  {files, xdc} or {sv, xdc}
  //   old tb:     {files, tb} or {sv, tb}
  if (!o) return null;
  const files = { ...(o.files || (o.sv ? { 'design.sv': o.sv } : null)) };
  if (!Object.keys(files).length) return null;
  delete files[XDC];
  if (o.tb && !files[TB]) files[TB] = o.tb;
  if (!files[TB]) files[TB] = STUB_TB;
  return { files, xdc: o.xdc || '' };
}
function readDraft() { try { return normalize(JSON.parse(localStorage.getItem(DRAFT) || 'null')); } catch { return null; } }
function readOldDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem('cs223sim.draft') || 'null');
    const tb = localStorage.getItem('cs223tb.draft');
    if (!d && !tb) return null;
    return normalize({ ...(d || { sv: EXAMPLES[DEFAULT_EXAMPLE].sv, xdc: EXAMPLES[DEFAULT_EXAMPLE].xdc }), tb: tb || undefined });
  } catch { return null; }
}
function fromExample(name) { const ex = EXAMPLES[name]; return { files: { 'design.sv': ex.sv, [TB]: ex.tb }, xdc: ex.xdc }; }
function initialDocs() {
  try { const h = location.hash.slice(1); if (h) { const d = normalize(JSON.parse(dec(h))); if (d) return d; } } catch { /* ignore */ }
  return readDraft() || readOldDrafts() || fromExample(DEFAULT_EXAMPLE);
}
const files = new Files({ bar: $('#ftabs'), host: $('#editors'), onRun: () => run(), fixed: ['design.sv', TB, XDC], onChange: saveDraft });
const docs = initialDocs();
files.load({ ...docs.files, [XDC]: docs.xdc });
function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify({ files: files.sources(), xdc: files.text(XDC) })); } catch { /* private mode */ } }
function designFiles() { const o = files.sources(); delete o[TB]; return o; }

const exSel = $('#examples');
for (const name of Object.keys(EXAMPLES)) { const o = document.createElement('option'); o.value = name; o.textContent = name; exSel.appendChild(o); }
exSel.value = '';
exSel.addEventListener('change', () => {
  if (!EXAMPLES[exSel.value]) return;
  const d = fromExample(exSel.value);
  files.load({ ...d.files, [XDC]: d.xdc }); history.replaceState(null, '', location.pathname + location.search); run();
});

// ---- views ------------------------------------------------------------
let view = 'board';
function setView(v, andRun = true) {
  view = v;
  $('#view-board').classList.toggle('on', v === 'board'); $('#view-tb').classList.toggle('on', v === 'tb');
  $('#board-view').hidden = v !== 'board'; $('#tb-view').hidden = v !== 'tb';
  consoleLabel.textContent = v === 'board' ? 'yosys' : 'iverilog';
  runBtn.textContent = v === 'board' ? 'run on board' : 'run testbench';
  const url = new URL(location.href); if (v === 'tb') url.searchParams.set('view', 'tb'); else url.searchParams.delete('view');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  try { localStorage.setItem('dewfpga.view', v); } catch { /* ignore */ }
  if (v === 'board') { if (sim && clkPort && !paused) start(); files.show(files.active === TB ? 'design.sv' : files.active); }
  else { stop(); wave.draw(); if (files.active === 'design.sv') files.show(TB); }
  if (andRun) run();   // the sources may have changed since this view last ran; a run is cheap
}
$('#view-board').addEventListener('click', () => setView('board'));
$('#view-tb').addEventListener('click', () => setView('tb'));

// ---- board ------------------------------------------------------------
let sim = null, binding = null, clkPort = null, running = false, paused = false, cyclesPerFrame = 10, measured = 0;
let dispAcc = [0, 0, 0, 0];
const board = new Board(svg, onBoardInput);
function onBoardInput(element, index, v) {
  if (!sim || !binding) return;
  for (const [port, entries] of Object.entries(binding.map)) for (const e of entries) if (e.element === element && e.index === index && e.dir === 'input') sim.setBit(port, e.bit, v);
  if (!running) { sim.settle(); paint(); }
}
const KEYS = { ArrowUp: 'btnU', ArrowDown: 'btnD', ArrowLeft: 'btnL', ArrowRight: 'btnR', Enter: 'btnC' };
svg.addEventListener('keydown', (e) => { if (KEYS[e.key]) { e.preventDefault(); board.pressButton(KEYS[e.key], 1); } });
svg.addEventListener('keyup', (e) => { if (KEYS[e.key]) { e.preventDefault(); board.pressButton(KEYS[e.key], 0); } });

// ---- console (right pane: what the compiler said) -----------------------
function log(lines, kind = '') {
  consoleEl.innerHTML = '';
  for (const l of lines) {
    const d = document.createElement('div'); d.className = `c-line ${kind}`;
    const m = /([\w.-]+\.(?:sv|v)):(\d+)/.exec(l);
    if (m && files.get(m[1])) { d.classList.add('c-link'); d.addEventListener('click', () => { files.show(m[1]); files.get(m[1]).goto(Number(m[2])); }); }
    d.textContent = l.replace(/\x1b\[[0-9;]*m/g, '').replace(/\/work\//g, '').replace(/^\s*ERROR:\s*/, 'error: ').replace(/^\s*(Warning|warning|error):\s*/i, (s) => s.toLowerCase());
    consoleEl.appendChild(d);
  }
}
function setStatus(t) { statusEl.textContent = t; }

// ---- run --------------------------------------------------------------
async function run() { saveDraft(); if (view === 'board') await runBoard(); else await runTb(); }
runBtn.addEventListener('click', run);

async function runBoard() {
  stop(); runBtn.disabled = true;
  setStatus('yosys is reading your design…');
  const res = await ask('yosys', { kind: 'compile', files: designFiles() }, 90000, (id) => ({ id, ok: false, log: 'yosys did not finish in 90 s. is the design very large, or is something generating a huge loop?' }));
  runBtn.disabled = false;
  const lines = (res.log || '').split('\n').filter((l) => l.trim());
  if (!res.ok) { log(lines.length ? lines : ['yosys failed without a message'], 'c-err'); setStatus('not running — fix the error and press run'); board.setPower(false); return; }
  if (sim) sim.shutdown();
  board.clearOutputs();
  try { sim = new Sim(res.json); } catch (err) { log([`could not build the circuit: ${err.message}`], 'c-err'); setStatus('not running'); return; }
  const xdc = parseXdc(files.text(XDC));
  binding = bindPorts(sim.ports(), xdc);
  const out = [];
  for (const e of xdc.errors) out.push(`${XDC} line ${e.line}: ${e.msg}`);
  for (const e of binding.errors) out.push(`xdc: ${e}`);
  for (const w of binding.warnings) out.push(`warning: ${w}`);
  for (const l of lines) if (!/^\s*$/.test(l)) out.push(l);
  clkPort = null;
  for (const [port, entries] of Object.entries(binding.map)) for (const e of entries) if (e.element === 'clk' && e.dir === 'input') clkPort = port;
  if (binding.errors.length || xdc.errors.length) { log(out, 'c-err'); setStatus('not running — every port needs a pin, like in vivado'); board.setLabels(binding.map); board.setPower(false); return; }
  out.unshift(`ok · top ${sim.top} · ${sim.cellCount} cells · ${sim.ports().length} ports · yosys ${res.ms} ms`);
  log(out);
  board.setLabels(binding.map); board.setPower(true);
  for (let i = 0; i < 16; i++) if (board.state.sw[i]) onBoardInput('sw', i, 1);
  sim.settle(); paint();
  paused = false; $('#pause').textContent = 'pause';
  if (clkPort) start(); else setStatus(`${sim.top} · combinational · no clock port bound`);
}

const wave = new Wave($('#wave'), () => {
  const cs = getComputedStyle(document.body);
  return { ink: cs.getPropertyValue('--ink').trim(), dim: cs.getPropertyValue('--ink-dim').trim(), accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg-soft').trim(), x: '#c9a03a' };
});
function printOut(lines) {
  outEl.innerHTML = '';
  for (const l of lines) { const d = document.createElement('div'); d.className = 'c-line'; d.textContent = l.replace(/\/work\//g, ''); outEl.appendChild(d); }
}
async function runTb() {
  runBtn.disabled = true;
  setStatus('iverilog is compiling…');
  const res = await ask('tb', { files: files.sources() }, 30000, (id) => ({ id, ok: false, stage: 'timeout', log: ['stopped after 30 s. is there a $finish? a testbench without one runs forever.'] }));
  runBtn.disabled = false;
  const lines = (res.log || []).map((l) => l.replace(/\/work\//g, ''));
  if (res.stage === 'compile' || res.stage === 'crash' || res.stage === 'timeout') {
    log(lines, 'c-err'); printOut([]); wave.set(null);
    setStatus(res.stage === 'timeout' ? 'stopped' : 'compile failed — fix the error and press run'); return;
  }
  log(lines.length ? lines : [`ok · compile ${res.msCompile} ms · run ${res.msRun} ms`]);
  const out = res.out || [];
  printOut(out.length ? out : ['(no output. add $display to the testbench to print, $dumpvars to get a waveform.)']);
  if (res.vcd) {
    const v = parseVcd(res.vcd); wave.set(v);
    setStatus(`compile ${res.msCompile} ms · run ${res.msRun} ms · ${v.signals.length} signals · ${fmtTime(v.tmax, v.timescale)} of simulated time`);
  } else {
    wave.set(null);
    setStatus(`compile ${res.msCompile} ms · run ${res.msRun} ms · no waveform ($dumpfile("wave.vcd") and $dumpvars(0, tb) to get one)`);
  }
}
function fmtTime(t, ts) {
  const m = /(\d+)\s*([munpf]?s)/.exec(ts || '1s'); if (!m) return `${t} ${ts}`;
  const exp = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 }[m[2]];
  const v = t * Number(m[1]) * 10 ** exp;
  for (const [u, e] of [['s', 0], ['ms', -3], ['us', -6], ['ns', -9], ['ps', -12]]) { if (v >= 10 ** e) return `${+(v / 10 ** e).toFixed(2)} ${u}`; }
  return `${t} ${ts}`;
}

// ---- simulation loop --------------------------------------------------
function readDigits() {
  const m = binding.map;
  const anEntries = Object.entries(m).flatMap(([p, es]) => es.filter((e) => e.element === 'an').map((e) => [p, e]));
  const segEntries = Object.entries(m).flatMap(([p, es]) => es.filter((e) => e.element === 'seg' || e.element === 'dp').map((e) => [p, e]));
  if (!anEntries.length || !segEntries.length) return;
  let mask = 0;
  for (const [p, e] of segEntries) if (sim.outBit(p, e.bit) === -1) mask |= 1 << (e.element === 'dp' ? 7 : e.index);
  for (const [p, e] of anEntries) if (sim.outBit(p, e.bit) === -1) dispAcc[e.index] |= mask;
}
function paint() {
  for (const [p, es] of Object.entries(binding.map)) for (const e of es) if (e.element === 'led' && e.dir === 'output') board.setLed(e.index, sim.outBit(p, e.bit));
  readDigits();
  for (let d = 0; d < 4; d++) { board.setDigit(d, dispAcc[d]); dispAcc[d] = 0; }
  if (sim.combLoop) setStatus('warning: the circuit never settled (combinational loop?)');
}
let last = performance.now(), cyc = 0;
function frame(now) {
  if (!running) return;
  const t0 = performance.now(); let n = 0;
  if (cyclesPerFrame === Infinity) { while (performance.now() - t0 < 11) { sim.cycle(clkPort); readDigits(); n++; } }
  else { while (n < cyclesPerFrame && performance.now() - t0 < 30) { sim.cycle(clkPort); readDigits(); n++; } }
  cyc += n; paint();
  board.tickClock(Math.floor(now / 500) % 2 === 0);
  if (now - last > 500) { measured = Math.round(cyc / ((now - last) / 1000)); cyc = 0; last = now; setStatus(`${sim.top} · ${fmtHz(measured)} simulated clock · ${sim.cycles.toLocaleString()} cycles`); }
  requestAnimationFrame(frame);
}
function fmtHz(h) { return h >= 1e6 ? `${(h / 1e6).toFixed(1)} mhz` : h >= 1e3 ? `${(h / 1e3).toFixed(1)} khz` : `${h} hz`; }
function start() { if (running) return; running = true; last = performance.now(); cyc = 0; requestAnimationFrame(frame); }
function stop() { running = false; board.tickClock(false); }
const SPEEDS = [1, 10, 100, 1000, 10000, Infinity];
function applySpeed() { cyclesPerFrame = SPEEDS[Number(speedEl.value)]; speedLabel.textContent = cyclesPerFrame === Infinity ? 'as fast as your browser can' : `${cyclesPerFrame.toLocaleString()} cycles per frame`; }
speedEl.addEventListener('input', applySpeed); applySpeed();
$('#pause').addEventListener('click', (e) => { if (!sim || !clkPort) return; if (running) { stop(); paused = true; e.target.textContent = 'resume'; } else { start(); paused = false; e.target.textContent = 'pause'; } });
$('#step').addEventListener('click', () => { if (!sim || !clkPort) return; if (running) { stop(); paused = true; $('#pause').textContent = 'resume'; } sim.cycle(clkPort); paint(); setStatus(`${sim.top} · stepped · ${sim.cycles.toLocaleString()} cycles`); });

// ---- share ------------------------------------------------------------
$('#share').addEventListener('click', async (e) => {
  const h = enc(JSON.stringify({ files: files.sources(), xdc: files.text(XDC) }));
  history.replaceState(null, '', `${location.pathname}${location.search}#${h}`);
  try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'link copied'; } catch { e.target.textContent = 'link is in the address bar'; }
  setTimeout(() => { e.target.textContent = 'share'; }, 1800);
});

// ---- boot -------------------------------------------------------------
let firstView = 'board';
try { firstView = localStorage.getItem('dewfpga.view') || firstView; } catch { /* ignore */ }
if (new URL(location.href).searchParams.get('view') === 'tb') firstView = 'tb';
setView(firstView, false);
if (firstView === 'tb') {
  setStatus('icarus verilog ready (2.8 mb) · press run or ⌘↵');
  run();
  ask('yosys', { kind: 'warm' }, 600000, (id) => ({ id, ok: false }));   // download yosys in the background for the board view
} else {
  setStatus('loading yosys (64 mb, once — your browser caches it)…');
  ask('yosys', { kind: 'warm' }, 600000, (id) => ({ id, ok: false })).then(() => { setStatus('yosys ready · press run or ⌘↵'); run(); });
}
window.dewfpga = window.cs223 = { get sim() { return sim; }, get binding() { return binding; }, get view() { return view; }, board, files, setView };
