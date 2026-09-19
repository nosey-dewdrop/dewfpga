import { Files } from './files.js';
import { Board } from './board.js';
import { Sim } from './engine.js';
import { parseXdc, bindPorts } from './xdc.js';
import { EXAMPLES, DEFAULT_EXAMPLE } from './examples.js';
import { compressToEncodedURIComponent as enc, decompressFromEncodedURIComponent as dec } from 'lz-string';
import '../site.js';

const $ = (s) => document.querySelector(s);
const consoleEl = $('#console'), statusEl = $('#status'), runBtn = $('#run'), speedEl = $('#speed'), speedLabel = $('#speed-label'), svg = $('#board');

// ---- state ------------------------------------------------------------
let sim = null, binding = null, clkPort = null, running = false, cyclesPerFrame = 10, measured = 0;
let dispAcc = [0, 0, 0, 0];
let worker = null, reqId = 0;
const pending = new Map();
function spawn() {
  worker = new Worker(new URL('./yosys.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.kind === 'progress') { const { done, total } = e.data; if (total) setStatus(`downloading yosys · ${(done / 1048576).toFixed(0)} of ${(total / 1048576).toFixed(0)} mb · once, then cached`); return; }
    const p = pending.get(e.data.id); if (p) { clearTimeout(p.timer); pending.delete(e.data.id); p.res(e.data); }
  };
}
spawn();
function ask(msg, ms = 90000) {
  return new Promise((res) => {
    const id = ++reqId;
    const timer = setTimeout(() => { pending.delete(id); worker.terminate(); spawn(); res({ id, ok: false, log: `yosys did not finish in ${ms / 1000} s. is the design very large, or is something generating a huge loop?` }); }, ms);
    pending.set(id, { res, timer }); worker.postMessage({ id, ...msg });
  });
}

// ---- files ------------------------------------------------------------
const DRAFT = 'cs223sim.draft';
function readDraft() { try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && (d.files || d.sv)) return { files: d.files || { 'design.sv': d.sv }, xdc: d.xdc || '' }; } catch { /* ignore */ } return null; }
function initialDocs() {
  try { const h = location.hash.slice(1); if (h) { const o = JSON.parse(dec(h)); if (o && (o.files || o.sv)) return { files: o.files || { 'design.sv': o.sv }, xdc: o.xdc || '' }; } } catch { /* ignore */ }
  const d = readDraft(); if (d) return d;
  const ex = EXAMPLES[DEFAULT_EXAMPLE]; return { files: { 'design.sv': ex.sv }, xdc: ex.xdc };
}
const files = new Files({ bar: $('#ftabs'), host: $('#editors'), onRun: run, fixed: ['design.sv', 'basys3.xdc'], onChange: saveDraft });
const docs = initialDocs();
files.load({ ...docs.files, 'basys3.xdc': docs.xdc });
function saveDraft() { try { const d = readDraft() || {}; localStorage.setItem(DRAFT, JSON.stringify({ ...d, files: files.sources(), xdc: files.text('basys3.xdc') })); } catch { /* private mode */ } }

const exSel = $('#examples');
for (const name of Object.keys(EXAMPLES)) { const o = document.createElement('option'); o.value = name; o.textContent = name; exSel.appendChild(o); }
exSel.value = '';
exSel.addEventListener('change', () => {
  const ex = EXAMPLES[exSel.value]; if (!ex) return;
  files.load({ 'design.sv': ex.sv, 'basys3.xdc': ex.xdc }); history.replaceState(null, '', location.pathname); run();
});

// ---- board ------------------------------------------------------------
const board = new Board(svg, onBoardInput);
function onBoardInput(element, index, v) {
  if (!sim || !binding) return;
  for (const [port, entries] of Object.entries(binding.map)) for (const e of entries) if (e.element === element && e.index === index && e.dir === 'input') sim.setBit(port, e.bit, v);
  if (!running) { sim.settle(); paint(); }
}
const KEYS = { ArrowUp: 'btnU', ArrowDown: 'btnD', ArrowLeft: 'btnL', ArrowRight: 'btnR', Enter: 'btnC' };
svg.addEventListener('keydown', (e) => { if (KEYS[e.key]) { e.preventDefault(); board.pressButton(KEYS[e.key], 1); } });
svg.addEventListener('keyup', (e) => { if (KEYS[e.key]) { e.preventDefault(); board.pressButton(KEYS[e.key], 0); } });

// ---- console ----------------------------------------------------------
function log(lines, kind = '') {
  consoleEl.innerHTML = '';
  for (const l of lines) {
    const d = document.createElement('div'); d.className = `c-line ${kind}`;
    const m = /([\w.-]+\.(?:sv|v)):(\d+)/.exec(l);
    if (m && files.get(m[1])) { d.classList.add('c-link'); d.addEventListener('click', () => { files.show(m[1]); files.get(m[1]).goto(Number(m[2])); }); }
    d.textContent = l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\s*ERROR:\s*/, 'error: ').replace(/^Warning:\s*/, 'warning: ');
    consoleEl.appendChild(d);
  }
}
function setStatus(t) { statusEl.textContent = t; }

// ---- run --------------------------------------------------------------
async function run() {
  saveDraft(); stop(); runBtn.disabled = true;
  setStatus('yosys is reading your design…');
  const res = await ask({ kind: 'compile', files: files.sources() });
  runBtn.disabled = false;
  const lines = (res.log || '').split('\n').filter((l) => l.trim());
  if (!res.ok) { log(lines.length ? lines : ['yosys failed without a message'], 'c-err'); setStatus('not running — fix the error and press run'); board.setPower(false); return; }
  if (sim) sim.shutdown();
  board.clearOutputs();
  try { sim = new Sim(res.json); } catch (err) { log([`could not build the circuit: ${err.message}`], 'c-err'); setStatus('not running'); return; }
  const xdc = parseXdc(files.text('basys3.xdc'));
  binding = bindPorts(sim.ports(), xdc);
  const out = [];
  for (const e of xdc.errors) out.push(`basys3.xdc line ${e.line}: ${e.msg}`);
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
  if (clkPort) start(); else setStatus(`${sim.top} · combinational · no clock port bound`);
}
runBtn.addEventListener('click', run);

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
$('#pause').addEventListener('click', (e) => { if (!sim || !clkPort) return; if (running) { stop(); e.target.textContent = 'resume'; } else { start(); e.target.textContent = 'pause'; } });
$('#step').addEventListener('click', () => { if (!sim || !clkPort) return; if (running) { stop(); $('#pause').textContent = 'resume'; } sim.cycle(clkPort); paint(); setStatus(`${sim.top} · stepped · ${sim.cycles.toLocaleString()} cycles`); });

// ---- share ------------------------------------------------------------
$('#share').addEventListener('click', async (e) => {
  const h = enc(JSON.stringify({ files: files.sources(), xdc: files.text('basys3.xdc') }));
  history.replaceState(null, '', `#${h}`);
  try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'link copied'; } catch { e.target.textContent = 'link is in the address bar'; }
  setTimeout(() => { e.target.textContent = 'share'; }, 1800);
});

// ---- boot -------------------------------------------------------------
setStatus('loading yosys (64 mb, once — your browser caches it)…');
ask({ kind: 'warm' }, 600000).then(() => { setStatus('yosys ready · press run or ⌘↵'); run(); });
window.cs223 = { get sim() { return sim; }, get binding() { return binding; }, board, files };
