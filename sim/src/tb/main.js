import { Files } from '../sim/files.js';
import { EXAMPLES } from '../sim/examples.js';
import { TB_EXAMPLES } from './examples.js';
import { parseVcd } from './vcd.js';
import { Wave } from './wave.js';
import { compressToEncodedURIComponent as enc, decompressFromEncodedURIComponent as dec } from 'lz-string';
import '../site.js';

const $ = (s) => document.querySelector(s);
const outEl = $('#out'), statusEl = $('#status'), runBtn = $('#run');

// design files are shared with the board tab through the same draft; tb.sv is this page's own
const SIM_DRAFT = 'cs223sim.draft';
function readSimDraft() { try { const d = JSON.parse(localStorage.getItem(SIM_DRAFT) || 'null'); if (d && (d.files || d.sv)) return d.files || { 'design.sv': d.sv }; } catch { /* ignore */ } return null; }
function loadDocs() {
  try { const h = location.hash.slice(1); if (h) { const o = JSON.parse(dec(h)); if (o && (o.files || o.sv) && o.tb) return { files: o.files || { 'design.sv': o.sv }, tb: o.tb }; } } catch { /* ignore */ }
  let f = readSimDraft() || { 'design.sv': EXAMPLES['switches to leds'].sv };
  let tb = TB_EXAMPLES['tb: switches to leds'];
  try { const t = localStorage.getItem('cs223tb.draft'); if (t) tb = t; } catch { /* ignore */ }
  return { files: f, tb };
}
const files = new Files({ bar: $('#ftabs'), host: $('#editors'), onRun: run, fixed: ['design.sv', 'tb.sv'], onChange: saveDraft });
const docs = loadDocs();
files.load({ ...docs.files, 'tb.sv': docs.tb });
files.show('tb.sv');
function designFiles() { const o = files.sources(); delete o['tb.sv']; return o; }
function saveDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(SIM_DRAFT) || '{}');
    localStorage.setItem(SIM_DRAFT, JSON.stringify({ ...d, files: designFiles() }));
    localStorage.setItem('cs223tb.draft', files.text('tb.sv'));
  } catch { /* ignore */ }
}
const exSel = $('#examples');
const PAIRS = { 'tb: switches to leds': 'switches to leds', 'tb: blink': 'blink', 'tb: traffic light fsm': 'traffic light fsm' };
for (const name of Object.keys(TB_EXAMPLES)) { const o = document.createElement('option'); o.value = name; o.textContent = name; exSel.appendChild(o); }
exSel.value = '';
exSel.addEventListener('change', () => {
  const tb = TB_EXAMPLES[exSel.value]; if (!tb) return;
  files.load({ 'design.sv': EXAMPLES[PAIRS[exSel.value]].sv, 'tb.sv': tb }); files.show('tb.sv'); history.replaceState(null, '', location.pathname); run();
});

// ---- worker with a watchdog (a testbench without $finish never ends) ----
let worker = null, reqId = 0, pendingRes = null, timer = null;
function spawn() { worker = new Worker(new URL('./tb.worker.js', import.meta.url), { type: 'module' }); worker.onmessage = (e) => { if (pendingRes && e.data.id === reqId) { clearTimeout(timer); const r = pendingRes; pendingRes = null; r(e.data); } }; }
spawn();
function ask(msg, ms) {
  return new Promise((res) => {
    pendingRes = res; const id = ++reqId; worker.postMessage({ id, ...msg });
    timer = setTimeout(() => { worker.terminate(); spawn(); pendingRes = null; res({ id, ok: false, stage: 'timeout', log: [`stopped after ${ms / 1000} s. is there a $finish? a testbench without one runs forever.`] }); }, ms);
  });
}

const wave = new Wave($('#wave'), () => {
  const cs = getComputedStyle(document.body);
  return { ink: cs.getPropertyValue('--ink').trim(), dim: cs.getPropertyValue('--ink-dim').trim(), accent: cs.getPropertyValue('--accent').trim(), bg: cs.getPropertyValue('--bg-soft').trim(), x: '#c9a03a' };
});
document.querySelectorAll('#pal button').forEach((b) => b.addEventListener('click', () => setTimeout(() => wave.draw(), 50)));

function print(lines, cls = '') {
  outEl.innerHTML = '';
  for (const l of lines) {
    const d = document.createElement('div'); d.className = 'c-line ' + cls;
    const m = /([\w.-]+\.(?:sv|v)):(\d+)/.exec(l);
    if (m && files.get(m[1])) { d.classList.add('c-link'); d.addEventListener('click', () => { files.show(m[1]); files.get(m[1]).goto(Number(m[2])); }); }
    d.textContent = l.replace(/\/work\//g, '').replace(/^\s*(error|warning):\s*/i, (s) => s.toLowerCase());
    outEl.appendChild(d);
  }
}
async function run() {
  saveDraft(); runBtn.disabled = true;
  statusEl.textContent = 'iverilog is compiling…';
  const res = await ask({ files: { ...designFiles(), 'tb.sv': files.text('tb.sv') } }, 30000);
  runBtn.disabled = false;
  const lines = (res.log || []).map((l) => l.replace(/\/work\//g, ''));
  if (res.stage === 'compile' || res.stage === 'crash' || res.stage === 'timeout') {
    print(lines, 'c-err'); statusEl.textContent = res.stage === 'timeout' ? 'stopped' : 'compile failed'; wave.set(null); return;
  }
  const out = [...(res.out || [])];
  if (lines.length) out.unshift(...lines);
  print(out.length ? out : ['(no output. add $display to the testbench to print, $dumpvars to get a waveform.)']);
  if (res.vcd) {
    const v = parseVcd(res.vcd);
    wave.set(v);
    statusEl.textContent = `compile ${res.msCompile} ms · run ${res.msRun} ms · ${v.signals.length} signals · ${fmtTime(v.tmax, v.timescale)} of simulated time`;
  } else {
    wave.set(null);
    statusEl.textContent = `compile ${res.msCompile} ms · run ${res.msRun} ms · no waveform ($dumpfile("wave.vcd") and $dumpvars(0, tb) to get one)`;
  }
}
function fmtTime(t, ts) {
  const m = /(\d+)\s*([munpf]?s)/.exec(ts || '1s'); if (!m) return `${t} ${ts}`;
  const exp = { s: 0, ms: -3, us: -6, ns: -9, ps: -12, fs: -15 }[m[2]];
  let v = t * Number(m[1]) * 10 ** exp;
  for (const [u, e] of [['s', 0], ['ms', -3], ['us', -6], ['ns', -9], ['ps', -12]]) { if (v >= 10 ** e) return `${+(v / 10 ** e).toFixed(2)} ${u}`; }
  return `${t} ${ts}`;
}
runBtn.addEventListener('click', run);
$('#share').addEventListener('click', async (e) => {
  const h = enc(JSON.stringify({ files: designFiles(), tb: files.text('tb.sv') }));
  history.replaceState(null, '', `#${h}`);
  try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'link copied'; } catch { e.target.textContent = 'link is in the address bar'; }
  setTimeout(() => { e.target.textContent = 'share'; }, 1800);
});
statusEl.textContent = 'icarus verilog ready (2.8 mb) · press run or ⌘↵';
run();
