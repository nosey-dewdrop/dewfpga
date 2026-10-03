// one workspace, two views. the files are the ones the command line works on: any .sv/.v (names free, folders
// kept), the headers and .mem they read, the .xdc. top and testbench come from the content, by the CLI's rule
// (templates/check_xdc.py): see project.js.
//   board:     yosys (wasm) synthesizes the design files, digitaljs drives the virtual basys3
//   testbench: icarus verilog (wasm) compiles everything including the testbench, runs it, draws the vcd
import { Files } from './files.js';
import { resolve, validateImport, entriesFromFileList, entriesFromDrop, zip, toRecord, kindOf, base, parseModules, serializeRecords, restoreRecords, archiveRecords } from './project.js';
import { createWorkspaceStore } from './workspace.js';
import { Board } from './board.js';
import { BoardLinks } from './board-links.js';
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
      // the worker is gone, so is everything else it was asked: settle those requests now instead of
      // letting their own timers kill the fresh worker later
      for (const [oid, o] of [...pending]) if (o.which === which) { clearTimeout(o.timer); pending.delete(oid); o.res(o.onTimeout(oid)); }
      res(onTimeout(id));
    }, ms);
    pending.set(id, { res, timer, which, onTimeout });
    (which === 'yosys' ? yosysW : tbW).postMessage({ id, ...msg });
  });
}
spawnYosys(); spawnTb();

// ---- files ------------------------------------------------------------
const DRAFT = 'dewfpga.draft';
// every shape ever put in a link or an old draft, as records: {files:{name:text}, xdc}, {sv, xdc}, {files, tb}, {sv, tb}
function normalize(o) {
  if (!o) return null;
  if (Array.isArray(o.files) && o.files.every((f) => f && typeof f.path === 'string')) return restoreRecords(o.files);
  const files = { ...(o.files || (o.sv ? { 'design.sv': o.sv } : null)) };
  if (!Object.keys(files).length) return null;
  if (o.tb && !files['tb.sv']) files['tb.sv'] = o.tb;
  if (!Object.keys(files).some((n) => n !== 'basys3.xdc' && !/\.xdc$/.test(n) && /\bmodule\s+\w+\s*;/.test(files[n] || ''))) if (!files['tb.sv']) files['tb.sv'] = STUB_TB;
  if (o.xdc && !files['basys3.xdc']) files['basys3.xdc'] = o.xdc;
  return Object.entries(files).filter(([n]) => kindOf(n)).map(([n, s]) => toRecord(n, null, s));
}
function readDraft() { try { return normalize(JSON.parse(localStorage.getItem(DRAFT) || 'null')); } catch { return null; } }
function readOldDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem('cs223sim.draft') || 'null');
    const tb = localStorage.getItem('cs223tb.draft');
    if (!d && !tb) return null;
    return normalize({ ...(d || {}), tb: tb || undefined });
  } catch { return null; }
}
function fromExample(name) { const ex = EXAMPLES[name]; return [toRecord('design.sv', null, ex.sv), toRecord('tb.sv', null, ex.tb), toRecord('basys3.xdc', null, ex.xdc)]; }
const store = createWorkspaceStore({ snapshot: () => ({ files: serializeRecords(files.all()), active: files.active, prefer, view, imported }), onState: showSaveState });
function initialDocs() {
  try {
    const h = location.hash.slice(1);
    if (h) {
      const shared = JSON.parse(dec(h)), d = normalize(shared);
      const selected = Object.fromEntries(['top','tb','xdc'].filter(k => typeof shared?.prefer?.[k] === 'string').map(k => [k,shared.prefer[k]]));
      if (d) return { files: d, prefer: selected, active: shared.active, imported: true };
    }
  } catch { /* invalid old links fall back to the saved workspace */ }
  const w = store.read();
  if (w) {
    try { return { files: restoreRecords(w.files), active: w.active, prefer: w.prefer || {}, imported: !!w.imported }; }
    catch (e) { showSaveState({ ok: false, error: `saved workspace could not be opened: ${e.message}` }); }
  }
  const d = readDraft() || readOldDrafts();
  return { files: d || fromExample(DEFAULT_EXAMPLE) };
}
let prefer = {}, imported = false, roles = null, runGeneration = 0;
const files = new Files({ bar: $('#ftabs'), host: $('#editors'), tree: $('#filetree'), onRun: () => run(), onChange: onFilesChange });
const docs = initialDocs();
prefer = docs.prefer || {}; imported = !!docs.imported;
files.load(docs.files, docs.active);
function invalidateRun() {
  runGeneration++; resetBoard(); wave.set(null); printOut([]); runBtn.disabled = false;
  setStatus('workspace changed · press run');
}
function onFilesChange(what, detail) {
  if (what === 'error') { setStatus(detail); return; }
  // Keep the selected constraint file's identity through rename/removal.
  if (what === 'rename' && prefer.xdc && detail.startsWith(prefer.xdc + ' -> ')) prefer.xdc = detail.slice(prefer.xdc.length + 4);
  if (what === 'remove' && prefer.xdc === detail) delete prefer.xdc;
  if (what !== 'active') { invalidateRun(); roles = null; renderRoles(); scheduleLint(); if (what === 'rename') applyMarks(); }
  store.schedule();
}
function showSaveState(s) { const el = $('#savestate'); if (!el) return; el.textContent = s.ok ? '' : s.error; el.classList.toggle('bad', !s.ok); }
function saveDraft() { store.flush(); }
function flushSave() { store.flush(); }
// Preserve project-relative paths in both virtual filesystems.
const engineNames = new Map();
function engineFiles(kinds) { const out = {}; for (const p of files.order) if (kinds.includes(kindOf(p))) { engineNames.set(p, p); out[p] = files.text(p); } return out; }
function roleInfo() { if (!roles) roles = resolve(files.all(), prefer); return roles; }
function designFiles() {
  const records = files.all(), { mods } = parseModules(records), out = engineFiles(['source']);
  for (const r of records) {
    const ms = [...mods.values()].filter(m => m.file === r.path);
    if (r.usage?.includes('design') === false || (ms.length && ms.every(m => m.tb))) delete out[r.path];
  }
  return out;
}
function extraFiles() { return engineFiles(['header', 'mem']); }
function currentXdcText() { const r = roleInfo(); return r.xdc ? files.text(r.xdc) : ''; }
// the roles line: top · testbench · xdc, with a select where the CLI would have stopped (two-tops, two-xdc-files)
function renderRoles() {
  const el = $('#roles'); if (!el) return; const r = roleInfo(); el.replaceChildren();
  const piece = (label, value, options, onPick, cls) => {
    const s = document.createElement('span'); s.className = 'role ' + (cls || '');
    s.append(label + ' ');
    if (options && options.length > 1) {
      const sel = document.createElement('select'); sel.className = 'role-pick'; sel.setAttribute('aria-label', `choose the ${label}`);
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = value || 'choose…'; o0.disabled = !!value; sel.appendChild(o0);
      for (const o of options) { const op = document.createElement('option'); op.value = o; op.textContent = o; op.selected = o === value; sel.appendChild(op); }
      sel.addEventListener('change', () => { onPick(sel.value); invalidateRun(); roles = null; renderRoles(); scheduleLint(); store.schedule(); });
      s.appendChild(sel);
    } else { const b = document.createElement('b'); b.textContent = value || 'none'; s.appendChild(b); }
    return s;
  };
  el.appendChild(piece('top', r.top, r.tops, (v) => { prefer.top = v; }, r.error && r.error.code === 'two-tops' ? 'bad' : ''));
  el.appendChild(piece('testbench', r.tb, r.tbs, (v) => { prefer.tb = v; }));
  el.appendChild(piece('xdc', r.xdc, r.xdcs, (v) => { prefer.xdc = v; }, r.xdcError ? 'bad' : ''));
  if (r.error) { const m = document.createElement('span'); m.className = 'role-msg bad'; m.textContent = `ERROR [${r.error.code}]: ${r.error.text}`; el.appendChild(m); }
  else if (r.xdcError) { const m = document.createElement('span'); m.className = 'role-msg bad'; m.textContent = `ERROR [${r.xdcError.code}]: ${r.xdcError.text}`; el.appendChild(m); }
  else if (r.why) { const m = document.createElement('span'); m.className = 'role-msg dim'; m.textContent = r.why; el.appendChild(m); }
}
renderRoles();
// ---- import (folder picker, drop) and export (zip) ------------------------
function replaceWorkspace(records, { from, notes = [], choices = {} } = {}) {
  const nonEmpty = files.order.length > 0 && (imported || files.all().some((r) => r.raw === null && r.text.trim()));
  if (nonEmpty && !window.confirm(`replace the ${files.order.length} files in the workspace with ${records.length} from ${from}?`)) { setStatus('kept the workspace'); return false; }
  store.flush(); invalidateRun(); prefer = choices; imported = true; files.load(records); history.replaceState(null, '', location.pathname + location.search);
  roles = null; renderRoles(); scheduleLint(); applyMarks(); store.schedule();
  const lines = [`opened ${records.length} files from ${from}`, ...notes];
  log(lines); setStatus(lines[0]); return true;
}
async function importFrom(getEntries, from) {
  try {
    const { entries, notes, skipped, prefer:choices } = await getEntries();
    const records = validateImport(entries);
    if (skipped) notes.push(`${skipped} files excluded: inactive/disabled sources, project metadata, unsupported types, or generated folders`);
    if (replaceWorkspace(records, { from, notes, choices })) run();
  } catch (e) { const lines = ['nothing was opened:', ...(e.problems || [e.message || String(e)])]; log(lines); setStatus('nothing was opened: ' + (e.problems ? `${e.problems.length} problems, see below` : e.message)); }
}
const folderInput = $('#folder-input');
if (folderInput) {
  $('#open-folder').addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', () => { if (folderInput.files.length) importFrom(() => entriesFromFileList(folderInput.files), 'the folder you opened'); folderInput.value = ''; });
}
const dropHost = $('.right') || document.body;
let dragDepth = 0;
dropHost.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dragDepth++; dropHost.classList.add('drop'); } });
dropHost.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
dropHost.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHost.classList.remove('drop'); } });
dropHost.addEventListener('drop', (e) => { if (!e.dataTransfer) return; e.preventDefault(); dragDepth = 0; dropHost.classList.remove('drop'); importFrom(() => entriesFromDrop(e.dataTransfer), 'the files you dropped'); });
function zipName() { const r = roleInfo(); return (r.top || 'dewfpga-workspace') + '.zip'; }
function zipBytes() { return zip(archiveRecords(files.all(), prefer)); }
$('#download').addEventListener('click', () => {
  let bytes;
  try { bytes = zipBytes(); }
  catch (e) { setStatus(`not downloaded: ${e.message}`); log([e.message], 'c-err'); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  const a = document.createElement('a'); a.href = url; a.download = zipName(); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const project = archiveRecords(files.all(), prefer).length > files.order.length;
  const message = `${a.download}: ${files.order.length} source files${project ? ' and a project file preserving folders and selected top/XDC' : ''}. Unzip it and run dewfpga sim or dewfpga bit in that folder.`;
  setStatus(message); log([message]);
});
// test hooks (what the e2e drives): import records without the picker, read the zip bytes
function importRecords(entries, from = 'test') { return importFrom(async () => ({ entries: entries.map((e) => ({ path: e.path, bytes: e.bytes ? Uint8Array.from(e.bytes) : undefined, text: e.text })), notes: [], skipped: 0 }), from); }

const exSel = $('#examples');
for (const name of Object.keys(EXAMPLES)) { const o = document.createElement('option'); o.value = name; o.textContent = name; exSel.appendChild(o); }
exSel.value = '';
exSel.addEventListener('change', () => {
  if (!EXAMPLES[exSel.value]) return;
  flushSave();
  const d = fromExample(exSel.value);
  if (replaceWorkspace(d, { from: `the example "${exSel.value}"` })) { imported = false; run(); }
  exSel.value = '';
});

// ---- views ------------------------------------------------------------
let view = 'board';
function setView(v, andRun = true) {
  flushSave(); runGeneration++; runBtn.disabled = false;
  view = v;
  $('#view-board').classList.toggle('on', v === 'board'); $('#view-tb').classList.toggle('on', v === 'tb');
  $('#board-view').hidden = v !== 'board'; $('#tb-view').hidden = v !== 'tb';
  consoleLabel.textContent = v === 'board' ? 'yosys' : 'iverilog';
  runBtn.textContent = v === 'board' ? 'run on board' : 'run testbench';
  const url = new URL(location.href); if (v === 'tb') url.searchParams.set('view', 'tb'); else url.searchParams.delete('view');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  try { localStorage.setItem('dewfpga.view', v); } catch { /* ignore */ }
  const r = roleInfo();
  if (v === 'board') { if (sim && clkPort && !paused) start(); if (files.active === r.tbFile && r.topFile) files.show(r.topFile); }
  else { stop(); wave.draw(); if (files.active === r.topFile && r.tbFile) files.show(r.tbFile); }
  store.schedule();
  scheduleLint(0);
  if (andRun) run();   // the sources may have changed since this view last ran; a run is cheap
}
$('#view-board').addEventListener('click', () => setView('board'));
$('#view-tb').addEventListener('click', () => setView('tb'));

// ---- board ------------------------------------------------------------
let sim = null, binding = null, clkPort = null, running = false, paused = false, cyclesPerFrame = 10, measured = 0;
let dispAcc = [0, 0, 0, 0], currentTiming = [], shownTiming = '';   // shownTiming: the hints the panel last opened for
const board = new Board(svg, onBoardInput);
const links = new BoardLinks(board, files);   // code <-> board hover, live only while a circuit is configured
function onBoardInput(element, index, v) {
  if (!sim || !binding) return;
  for (const [port, entries] of Object.entries(binding.map)) for (const e of entries) if (e.element === element && e.index === index && e.dir === 'input') sim.setBit(port, e.bit, v);
  if (!running) { sim.settle(); paint(); }
}

// ---- console (right pane: what the compiler said) -----------------------
// a line is a string or {kind, file, line, text}. a line that names one of your files (file:line, from the
// diagnostic itself or found in the text) is a link: click it and the editor opens that file at that line.
const KIND_CLASS = { error: 'c-err', warning: 'c-warn', note: 'c-note' };
function lineEl(l, kind) {
  const d = document.createElement('div');
  const o = typeof l === 'string' ? { text: l } : l;
  d.className = `c-line ${KIND_CLASS[o.kind] || kind || ''}`.trim();
  const text = String(o.text == null ? '' : o.text).replace(/\x1b\[[0-9;]*m/g, '').replace(/\/work\//g, '').replace(/^\s*ERROR:\s*/, 'error: ').replace(/^\s*(Warning|warning|error):\s*/i, (s) => s.toLowerCase());
  const at = locate(o, text);
  if (at) { d.classList.add('c-link'); d.dataset.file = at.file; d.dataset.line = String(at.line); d.addEventListener('click', () => { const ed = files.get(at.file); if (!ed) return; files.show(at.file); ed.goto(at.line); }); }
  d.textContent = text;
  return d;
}
// the file and line a diagnostic points at, if it names one of your files; from its own fields first, else from its text
// compilers name an included header by its search path ("./defs.svh"); the project calls it "defs.svh"
const projectPath = (p) => String(p).replace(/^(\.\/)+/, '');
function locate(o, text = String(o.text == null ? '' : o.text).replace(/\/work\//g, '')) {
  if (o.file && files.get(projectPath(o.file))) return { file: projectPath(o.file), line: Number(o.line) || 1 };
  const m = /([\w./ -]+\.(?:sv|v|svh|vh|xdc)):(\d+)/.exec(text);
  return m && files.get(projectPath(m[1])) ? { file: projectPath(m[1]), line: Number(m[2]) } : null;
}
function log(lines, kind = '') { consoleEl.innerHTML = ''; appendLog(lines, kind); }
function appendLog(lines, kind = '') { for (const l of lines) consoleEl.appendChild(lineEl(l, kind)); }
function setStatus(t) { statusEl.textContent = t; }

// ---- live diagnostics (#20) --------------------------------------------
// while you type: 400 ms after the last change the current view's compiler reads the sources again
// (yosys for the board, iverilog for the testbench), without starting a circuit or a simulation. errors
// and warnings land in the problems panel and as marks on their lines; only errors keep run closed.
// a change makes the verdict unresolved (run allowed) until the next reply; replies for older contents,
// another view or an older generation are dropped. a run in flight answers for the pending lint.
const problemsEl = $('#problems'), problemsLabel = $('#problems-label'), lintStateEl = $('#lint-state');
const LINT_DEBOUNCE = 400;
// how long a check may take before its worker is replaced (the tests shorten these to reach the path quickly)
const lintTimeout = { board: 90000, tb: 60000 };
// a check that did not finish says nothing about the design: say so, never "none", and never close run for it
const unchecked = (what) => [{ kind: 'warning', unchecked: true, text: `${what}, so these sources are unchecked. run compiles them again.` }];
const lint = { timer: 0, generation: 0, inflight: 0, busy: new Set(), result: null, hasErrors: false, diags: [] };
let yosysWarm = null;
function gateRun() { runBtn.disabled = runsInFlight > 0 || lint.hasErrors; }
function scheduleLint(ms = LINT_DEBOUNCE) {
  clearTimeout(lint.timer);
  lint.generation++; lint.result = null; lint.hasErrors = false;
  if (lintStateEl) lintStateEl.textContent = 'checking…';
  lint.timer = setTimeout(startLint, ms);
  gateRun();
}
// what resolve() already knows is wrong with the workspace, as the compiler would report it for this view
function roleProblems(r, v) {
  const p = (e) => [{ kind: 'error', code: e.code, text: `ERROR [${e.code}]: ${e.text}` }];
  if (r.error) return p(r.error);
  if (v === 'board') return r.xdcError ? p(r.xdcError) : r.xdc ? [] : p({ code: 'no-xdc-file', text: 'add an .xdc pin file before running on the board.' });
  if (r.tbError) return p(r.tbError);
  return r.tb ? [] : [{ kind: 'error', code: 'no-testbench', text: `no testbench for ${r.top}: a testbench is a module with no ports that instantiates ${r.top}. Fix: add one (+ file), the examples show the shape.` }];
}
function yosysDiags(res) {
  const out = (res.diags || []).filter((d) => d && (d.kind === 'error' || d.kind === 'warning')).map(includeSite);
  if (res.ok === false && !res.cancelled && !out.some((d) => d.kind === 'error')) out.push({ kind: 'error', text: 'yosys failed without a message, see the console' });
  return out;
}
// iverilog prints plain lines: "file:line: error: …", "file:line: sorry: …" (a limitation, the design is fine),
// "file:line: warning: …". only the error class closes run; a failed compile with no error line gets one.
// iverilog reports a missing include on the line after the directive: point at the directive itself
function includeLine(file, name, line) {
  const lines = files.text(file).split('\n');
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) if (/`include\b/.test(lines[i]) && lines[i].includes(name)) return i + 1;
  return line;
}
// yosys names a missing include without saying where it was asked for: find the directive in the sources
function includeSite(d) {
  const m = !d.file && !locate(d) && /Can't open include file `([^']+)'/.exec(d.text || '');
  if (!m) return d;
  for (const p of files.order) {
    const at = files.text(p).split('\n').findIndex((l) => /`include\b/.test(l) && l.includes(m[1]));
    if (at >= 0) return { ...d, file: p, line: at + 1, text: `${p}:${at + 1}: ${d.text}` };
  }
  return d;
}
function icarusDiags(res) {
  const out = [];
  for (const raw of res.log || []) {
    let text = projectPath(String(raw).replace(/\/work\//g, ''));
    const m = /^([\w./ -]+\.(?:sv|v|svh|vh)):(\d+):\s*(.*)$/.exec(text);
    const body = m ? m[3] : text;
    let kind = null, line = m ? Number(m[2]) : undefined;
    const missing = m && /^Include file (\S+) not found/.exec(body);
    if (/^(sorry|warning)\b/i.test(body)) kind = 'warning';
    else if (missing) { kind = 'error'; line = includeLine(m[1], missing[1], line); text = `${m[1]}:${line}: error: ${body}`; }
    else if (/^(syntax error|internal error|error)\b/i.test(body) || (m && /\berror\b/i.test(body) && !/^ERROR \[/.test(body))) kind = 'error';
    if (kind && !out.some((d) => d.text === text)) out.push({ kind, file: m ? m[1] : undefined, line, text });
  }
  const failed = res.stage === 'compile' && res.ok === false;
  if (!failed) return out.filter((d) => d.kind !== 'error');   // the compile passed: anything else is runtime, not a lint error
  if (!out.some((d) => d.kind === 'error')) out.push({ kind: 'error', text: 'iverilog failed without a located message, see the console' });
  return out;
}
async function startLint() {
  lint.timer = 0;
  const gen = lint.generation, v = view;
  if (runsInFlight > 0) return;   // the run answers for this generation (run() lints afterwards if it did not)
  const r = roleInfo();
  const problems = roleProblems(r, v);
  if (problems.length) { applyLint(gen, v, problems); return; }
  if (lintStateEl) lintStateEl.textContent = 'checking…';
  // one check per worker at a time. a worker cannot drop a queued request while it compiles, so a check per
  // typing pause would queue one compile per pause; the running one restarts the check for the newest sources
  if (lint.busy.has(v)) return;
  lint.busy.add(v); lint.inflight++;
  let diags = null;
  try {
    if (v === 'board') {
      if (yosysWarm) await yosysWarm;
      if (gen === lint.generation && v === view && runsInFlight === 0) {
        const ms = lintTimeout.board;
        const res = await ask('yosys', { kind: 'lint', files: designFiles(), extra: extraFiles(), top: r.top }, ms, (id) => ({ id, ok: false, timedOut: true, diags: [] }));
        diags = res.timedOut ? unchecked(`the live check (yosys) did not finish in ${ms / 1000} s`) : yosysDiags(res);
      }
    } else {
      const ms = lintTimeout.tb;
      const res = await ask('tb', { files: engineFiles(['source']), extra: extraFiles(), top: r.tb, compileOnly: true }, ms, (id) => ({ id, ok: false, stage: 'timeout', log: [] }));
      diags = res.stage === 'timeout' ? unchecked(`the live check (iverilog) did not finish in ${ms / 1000} s`)
        : res.stage === 'crash' ? unchecked(`the live check (iverilog) stopped: ${String((res.log || []).at(-1) || 'no message')}`) : icarusDiags(res);
    }
  } finally {
    lint.inflight--; lint.busy.delete(v);
    if (lint.inflight === 0 && !lint.timer && lintStateEl && lint.result) lintStateEl.textContent = '';
  }
  if (gen !== lint.generation || v !== view) {   // stale: the sources or the view moved on
    if (v === view && !lint.result && !lint.timer) startLint();   // newer sources were waiting for this worker
    return;
  }
  if (diags) applyLint(gen, v, diags);   // none: a run started during the warm-up and answers for these sources
}
// a run answers for its sources when the check has not, or could not: an unchecked verdict gives way to what the run found
function lintFromRun(lintGen, v, diags) { if (lintGen === lint.generation && v === view && (!lint.result || lint.diags.some((d) => d.unchecked))) applyLint(lintGen, v, diags); }
function applyLint(gen, v, diags) {
  if (gen !== lint.generation || v !== view) return;
  lint.result = { generation: gen, view: v, diags };
  lint.diags = diags;
  lint.hasErrors = diags.some((d) => d.kind === 'error');
  if (lintStateEl) lintStateEl.textContent = lint.inflight > 0 || lint.timer ? 'checking…' : '';
  renderProblems(); applyMarks(); gateRun();
}
function renderProblems() {
  if (!problemsEl) return;
  problemsEl.innerHTML = '';
  let errors = 0, warnings = 0;
  for (const d of lint.diags) {
    if (d.kind === 'error') errors++; else warnings++;
    const row = document.createElement('div'); row.className = `p-row ${d.kind === 'error' ? 'p-err' : 'p-warn'}`;
    const tag = document.createElement('span'); tag.className = 'p-tag'; tag.textContent = d.kind;
    row.append(tag, lineEl(d));
    if (d.kind === 'error') {
      // a hint per error. not wired yet: it only tells you so on hover, a click does nothing
      const h = document.createElement('button'); h.type = 'button'; h.className = 'hint'; h.textContent = 'hint';
      h.setAttribute('aria-disabled', 'true'); h.title = 'coming soon!';
      const tip = document.createElement('span'); tip.className = 'tip'; tip.textContent = 'coming soon!'; h.appendChild(tip);
      h.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      row.appendChild(h);
    }
    problemsEl.appendChild(row);
  }
  const n = (k, w) => `${k} ${w}${k === 1 ? '' : 's'}`;
  if (problemsLabel) problemsLabel.textContent = errors + warnings ? `problems · ${n(errors, 'error')} · ${n(warnings, 'warning')}` : 'problems · none';
}
// whole-line marks in every open editor, from the last verdict. editors that were just (re)created start blank,
// so this runs again after a rename or a workspace load
function applyMarks() {
  const by = new Map();
  for (const d of lint.diags) { const at = locate(d); if (at) { if (!by.has(at.file)) by.set(at.file, []); by.get(at.file).push({ kind: d.kind, line: at.line }); } }
  for (const p of files.order) { const ed = files.get(p); if (ed && ed.setDiagnostics) ed.setDiagnostics(by.get(p) || []); }
}

// ---- run --------------------------------------------------------------
let runsInFlight = 0;
async function run() {
  if (lint.hasErrors) { setStatus('not running — fix the errors in the problems panel'); gateRun(); return; }
  flushSave(); const generation = ++runGeneration;
  // a run compiles the same sources the pending lint would: let the run answer, lint only if it did not
  clearTimeout(lint.timer); lint.timer = 0; const lintGen = lint.generation;
  runsInFlight++;
  try { if (view === 'board') await runBoard(generation, lintGen); else await runTb(generation, lintGen); }
  finally { runsInFlight--; if (!lint.result && !lint.timer && lint.inflight === 0) startLint(); gateRun(); }
}
runBtn.addEventListener('click', run);

function resetBoard() {
  // the old circuit is gone before the new one is read: no old led or digit survives a failed run, no old tick runs on
  stop(); if (sim) sim.shutdown(); sim = null; binding = null; clkPort = null; dispAcc = [0, 0, 0, 0];
  board.clearOutputs(); board.clearLabels(); links.clear(); board.setDone(false); board.setPower(true);
  currentTiming = []; measured = 0; renderTiming();
}
async function runBoard(generation, lintGen) {
  resetBoard(); runBtn.disabled = true;
  const r = roleInfo();
  const problem = r.error || r.xdcError || (!r.xdc && { code: 'no-xdc-file', text: 'add an .xdc pin file before running on the board.' });
  if (problem) { runBtn.disabled = false; log([`ERROR [${problem.code}]: ${problem.text}`], 'c-err'); setStatus(`not running — ERROR [${problem.code}], see the console`); return; }
  const XDC = r.xdc;
  setStatus('yosys is reading your design…');
  const res = await ask('yosys', { kind: 'compile', files: designFiles(), extra: extraFiles(), top: r.top }, 90000, (id) => ({ id, ok: false, timedOut: true, diags: [{ kind: 'error', text: 'yosys did not finish in 90 s. is the design very large, or is something generating a huge loop?' }] }));
  if (generation !== runGeneration || view !== 'board') return;
  runBtn.disabled = false;
  const lines = res.diags || (res.log || '').split('\n').filter((l) => l.trim());
  // a compile that ran out of time found nothing wrong with the sources: the console says so, the panel keeps run open
  lintFromRun(lintGen, 'board', res.timedOut ? unchecked('yosys did not finish in 90 s') : yosysDiags(res));
  if (!res.ok) { log(lines.length ? lines : ['yosys failed without a message'], 'c-err'); setStatus('not running — fix the error and press run'); return; }
  try { sim = new Sim(res.json); } catch (err) { sim = null; log([{ kind: 'error', text: `could not build the circuit: ${err.message}` }, ...lines], 'c-err'); setStatus('not running'); return; }
  const xdc = parseXdc(files.text(XDC));
  binding = bindPorts(sim.ports(), xdc);
  const out = [];
  for (const e of xdc.errors) out.push(`${XDC} line ${e.line}: ${e.msg}`);
  for (const e of binding.errors) out.push(`xdc: ${e}`);
  for (const w of binding.warnings) out.push(`warning: ${w}`);
  for (const l of lines) if (!(typeof l === 'string' && /^\s*$/.test(l))) out.push(l);
  clkPort = null;
  for (const [port, entries] of Object.entries(binding.map)) for (const e of entries) if (e.element === 'clk' && e.dir === 'input') clkPort = port;
  if (binding.errors.length || xdc.errors.length) { log(out, 'c-err'); setStatus('not running — every port needs a pin, like in vivado'); board.setLabels(binding.map); links.set({ binding, roles: r }); sim.shutdown(); sim = null; binding = null; clkPort = null; return; }
  out.unshift(`ok · top ${sim.top} · ${sim.cellCount} cells · ${sim.ports().length} ports · yosys ${res.ms} ms${res.reader === 'slang' ? ' · read with yosys-slang' : ''}`);
  log(out);
  board.setLabels(binding.map); links.set({ binding, roles: r }); board.setPower(true); board.setDone(true);
  currentTiming = res.timingHints || [];
  // the panel opens for new advice only: a rerun, a view switch or an edit that keeps the same hints leaves it as the user left it
  const sig = JSON.stringify(currentTiming.map((h) => [h.kind, h.signal, h.bit, h.cycles]));
  if (currentTiming.length && sig !== shownTiming) $('#timing-help').open = true;
  shownTiming = sig; renderTiming();
  for (let i = 0; i < 16; i++) if (board.state.sw[i]) onBoardInput('sw', i, 1);
  for (const [n, v] of Object.entries(board.state.btn)) if (v) onBoardInput(n, 0, 1);   // a button held through the run is held
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
async function runTb(generation, lintGen) {
  runBtn.disabled = true;
  setStatus('iverilog is compiling…');
  const r = roleInfo();
  const problem = r.error || r.tbError;
  if (problem) { runBtn.disabled = false; log([`ERROR [${problem.code}]: ${problem.text}`], 'c-err'); setStatus(`compile failed — ERROR [${problem.code}]`); return; }
  if (!r.tb) { runBtn.disabled = false; log([`no testbench for ${r.top}: a testbench is a module with no ports that instantiates ${r.top}. Fix: add one (+ file), the examples show the shape.`]); setStatus('compile failed — no testbench'); return; }
  const res = await ask('tb', { files: engineFiles(['source']), extra: extraFiles(), top: r.tb }, 30000, (id) => ({ id, ok: false, stage: 'timeout', log: ['stopped after 30 s. is there a $finish? a testbench without one runs forever.'] }));
  if (generation !== runGeneration || view !== 'tb') return;
  runBtn.disabled = false;
  const lines = (res.log || []).map((l) => l.replace(/\/work\//g, ''));
  if (res.stage === 'compile' || res.stage === 'run') lintFromRun(lintGen, 'tb', icarusDiags(res));
  if (res.stage === 'compile' || res.stage === 'crash' || res.stage === 'timeout') {
    log(lines, 'c-err'); printOut([]); wave.set(null);
    setStatus(res.stage === 'timeout' ? 'stopped' : 'compile failed — fix the error and press run'); return;
  }
  log(lines.length ? lines : [`ok · compile ${res.msCompile} ms · run ${res.msRun} ms`], res.ok ? undefined : 'c-err');
  const out = res.out || [];
  printOut(out.length ? out : ['(no output. add $display to the testbench to print, $dumpvars to get a waveform.)']);
  if (res.vcd) {
    const v = parseVcd(res.vcd); wave.set(v);
    setStatus(`compile ${res.msCompile} ms · run ${res.msRun} ms · ${v.signals.length} signals · ${fmtTime(v.tmax, v.timescale)} of simulated time`);
  } else {
    wave.set(null);
    setStatus(`compile ${res.msCompile} ms · run ${res.msRun} ms · no waveform ($dumpfile("wave.vcd") and $dumpvars(0, tb) to get one)`);
  }
  if (!res.ok) setStatus(`compile ${res.msCompile} ms · run failed — ERROR [${res.code || 'sim-exit'}], see output`);
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
  if (!sim || !binding) return;
  for (const [p, es] of Object.entries(binding.map)) for (const e of es) if (e.element === 'led' && e.dir === 'output') board.setLed(e.index, sim.outBit(p, e.bit));
  readDigits();
  for (let d = 0; d < 4; d++) { board.setDigit(d, dispAcc[d]); dispAcc[d] = 0; }
  if (sim.combLoop) setStatus('warning: the circuit never settled (combinational loop?)');
}
let last = performance.now(), cyc = 0;
function frame(now) {
  if (!running) return;
  if (!sim || !clkPort) { running = false; return; }
  const t0 = performance.now(); let n = 0;
  // Every speed gets the same frame budget; Max removes the cycle cap, not CPU time.
  while (n < cyclesPerFrame && performance.now() - t0 < 8) { sim.cycle(clkPort); readDigits(); n++; }
  cyc += n; paint();
  board.tickClock(Math.floor(now / 500) % 2 === 0);
  if (now - last > 500) { measured = Math.round(cyc / ((now - last) / 1000)); cyc = 0; last = now; setStatus(`${sim.top} · ${fmtHz(measured)} simulated clock · ${sim.cycles.toLocaleString()} cycles`); renderTiming(); }
  requestAnimationFrame(frame);
}
function renderTiming() {
  const host = $('#timing-help'); if (!host) return;
  host.hidden = !currentTiming.length;
  if (!currentTiming.length) return;
  const hint = currentTiming[0], wait = measured ? hint.cycles / measured : null;
  const duration = (seconds) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} hours` : seconds >= 60 ? `${(seconds / 60).toFixed(1)} minutes` : `${seconds.toFixed(2)} seconds`;
  $('#timing-estimate').textContent = `${hint.signal} ${hint.kind === 'bit' ? `bit ${hint.bit} has a ${hint.cycles.toLocaleString()}-cycle interval when counting continuously` : `has a ${hint.cycles.toLocaleString()}-cycle threshold`} (${duration(hint.cycles / 100000000)} at 100 MHz). ${wait === null ? 'Measuring browser speed…' : `At the current ${fmtHz(measured)} simulation speed, that many cycles take about ${duration(wait)}.`} An enable or reset can delay the output further.`;
  const example = hint.kind === 'bit' ? '`ifdef SIM\n  localparam integer COUNTER_WIDTH = 8;\n`else\n  localparam integer COUNTER_WIDTH = ' + (hint.bit + 1) + ';\n`endif\n// Size your counter with COUNTER_WIDTH, and use\n// counter[COUNTER_WIDTH-1] for this divided signal.' : '`ifdef SIM\n  localparam integer HALF_PERIOD = 64;\n`else\n  localparam integer HALF_PERIOD = ' + hint.cycles + ';\n`endif\n// Use HALF_PERIOD in your divider comparison.';
  if ($('#timing-example').textContent !== example) $('#timing-example').textContent = example;
}
function fmtHz(h) { return h >= 1e6 ? `${(h / 1e6).toFixed(1)} mhz` : h >= 1e3 ? `${(h / 1e3).toFixed(1)} khz` : `${h} hz`; }
function start() { if (running) return; running = true; last = performance.now(); cyc = 0; requestAnimationFrame(frame); }
function stop() { running = false; board.tickClock(false); }
const SPEEDS = [1, 10, 100, 1000, 10000, Infinity];
function applySpeed() { cyclesPerFrame = SPEEDS[Number(speedEl.value)]; speedLabel.textContent = cyclesPerFrame === Infinity ? 'as fast as your browser can' : `${cyclesPerFrame.toLocaleString()} cycles per frame`; }
speedEl.addEventListener('input', applySpeed); applySpeed();
$('#pause').addEventListener('click', (e) => { if (!sim || !clkPort) return; if (running) { stop(); paused = true; e.target.textContent = 'resume'; } else { start(); paused = false; e.target.textContent = 'pause'; } });
$('#step').addEventListener('click', () => { if (!sim || !clkPort) return; if (running) { stop(); paused = true; $('#pause').textContent = 'resume'; } sim.cycle(clkPort); paint(); setStatus(`${sim.top} · stepped · ${sim.cycles.toLocaleString()} cycles`); renderTiming(); });

// ---- share ------------------------------------------------------------
$('#share').addEventListener('click', async (e) => {
  try {
    const h = enc(JSON.stringify({ files: serializeRecords(files.all()), prefer, active: files.active }));
    history.replaceState(null, '', `${location.pathname}${location.search}#${h}`);
  } catch {
    setStatus('could not create a share link · download the project ZIP instead'); return;
  }
  try { await navigator.clipboard.writeText(location.href); e.target.textContent = 'link copied'; } catch { e.target.textContent = 'link is in the address bar'; }
  setTimeout(() => { e.target.textContent = 'share'; }, 1800);
});

// ---- boot -------------------------------------------------------------
board.setPower(true); board.setDone(false);
let firstView = 'board';
try { firstView = localStorage.getItem('dewfpga.view') || firstView; } catch { /* ignore */ }
if (new URL(location.href).searchParams.get('view') === 'tb') firstView = 'tb';
setView(firstView, false);
if (firstView === 'tb') {
  setStatus('icarus verilog ready (2.8 mb) · press run or ⌘↵');
  run();
  yosysWarm = ask('yosys', { kind: 'warm' }, 600000, (id) => ({ id, ok: false }));   // download yosys in the background for the board view
} else {
  setStatus('loading yosys (64 mb, once — your browser caches it)…');
  yosysWarm = ask('yosys', { kind: 'warm' }, 600000, (id) => ({ id, ok: false }));
  yosysWarm.then(() => { setStatus('yosys ready · press run or ⌘↵'); run(); });
}
window.dewfpga = window.cs223 = { get pendingRequests() { return pending.size; }, get sim() { return sim; }, get binding() { return binding; }, get view() { return view; }, get roles() { return roleInfo(); }, get lintTimeout() { return lintTimeout; }, get lint() { return { generation: lint.generation, settled: !!lint.result, pending: !!lint.timer || lint.inflight > 0, hasErrors: lint.hasErrors, diags: lint.diags.map((d) => ({ ...d })) }; }, board, files, setView, importRecords, zipBytes, store };
