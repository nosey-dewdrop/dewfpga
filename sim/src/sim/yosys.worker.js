import { fileTree, includeDirs } from './vfs.js';
import { runYosys } from '@yowasp/yosys';
import { scanSources, packagesFirst } from './source-scan.js';
import { scratchNames, slangTree, readVerilogScript, readSlangScript, checkReadScript, checkSynthScript, libraryClash, guardCode, parseLog, slangMayHelp, missingModule, locateInstance, missingModuleDiag, printNote, slangNote, vNote, printCount, promoteDrivers, implicitNames, preflightDiagnostics, timingHints, MAX_LOG } from './yosys-pipeline.js';

let warm = null;
function warmUp() {
  if (!warm) warm = runYosys(['-V'], {}, { stdout: null, stderr: null, fetchProgress: (e) => self.postMessage({ kind: 'progress', done: e.doneLength, total: e.totalLength }) }).catch(() => {});
  return warm;
}
const td = new TextDecoder();
const str = (x) => (x == null ? '' : typeof x === 'string' ? x : td.decode(x));
const clean = (t) => String(t).replace(/^﻿/, '').replace(/\r\n?/g, '\n');

// one yosys run: {ok, out, log}. the log is bounded; -q keeps yosys' own reader quiet, slang prints its
// diagnostics to stdout only without -q, so the slang pass runs without it.
async function yosys(args, tree) {
  let log = '';
  const sink = (s) => { if (s != null && log.length < MAX_LOG) log += typeof s === 'string' ? s : td.decode(s); };
  try { const out = await runYosys(args, fileTree(tree), { stdout: sink, stderr: sink, decodeASCII: true }); return { ok: true, out, log }; }
  catch (err) { return { ok: false, out: {}, log, err: String((err && err.message) || err) }; }
}

let queue = Promise.resolve(), latest = 0;
// forceSlang: read with yosys-slang from the start (the hardware check of a build yosys' own reader accepted
// collided with the cell library, see libraryClash; the command line rebuilds with slang in that case too)
async function compile(id, files, extra = {}, top, forceSlang = false) {
  const t0 = performance.now();
  const tree = {}; for (const [n, t] of Object.entries({ ...extra, ...files })) tree[n] = clean(t);
  // a package file first, so pkg::NAME resolves in the files after it (the files themselves are never renamed)
  const names = packagesFirst(Object.keys(files), tree);
  const dirs = includeDirs(names);
  const sc = scratchNames(Object.keys(tree));
  // 0. the command line's source scans: code both readers accept but build differently from the simulation
  const scan = scanSources(Object.fromEntries(names.map((n) => [n, tree[n]])));
  if (scan.some((d) => d.kind === 'error')) return { id, ok: false, diags: scan, ms: Math.round(performance.now() - t0) };
  // 1. yosys' own reader
  let reader = 'yosys', r = forceSlang ? { ok: false, out: {}, log: '' } : await yosys(['-q', '-p', readVerilogScript(names, top, dirs, sc)], tree);
  let diags = parseLog(r.log);
  if (!forceSlang && !r.ok && !r.log && /WebAssembly|wasm/i.test(r.err || '')) {
    diags = [{ kind: 'error', text: r.err }, { kind: 'text', text: 'yosys could not start in this browser. an old copy may be cached: reload the page once with a hard refresh (cmd shift r). if it keeps failing, try chrome or firefox and tell me which browser and version you are on.' }];
    return { id, ok: false, diags, ms: Math.round(performance.now() - t0) };
  }
  // a hierarchical name or an interface member yosys' reader left as an undriven wire is a refusal too: the
  // command line hands that code to yosys-slang (templates/Makefile), which resolves it in hierarchy
  const unresolved = r.ok && implicitNames(diags, tree).some((d) => /\[(hierarchical-name|interface-member)\]/.test(d.text));
  if (unresolved) diags = implicitNames(diags, tree);
  // 2. the second reader, when the first refused the code
  if (forceSlang || (!r.ok && slangMayHelp(diags)) || unresolved) {
    const s = await yosys(['-p', readSlangScript(names, top, dirs, sc)], slangTree(tree, names, dirs, sc));
    const sdiags = parseLog(s.log).filter((d) => d.kind !== 'text');
    if (s.ok) { reader = 'slang'; r = s; diags = [slangNote(null), ...sdiags]; }
    else {
      const first = diags.filter((d) => d.kind === 'error');
      diags = [...first.map((d) => ({ ...d, text: `yosys' reader: ${d.text}` })), ...sdiags.map((d) => ({ ...d, text: `yosys-slang: ${d.text}` }))];
      if (names.some((n) => /\.v$/i.test(n))) diags.push(vNote());
      return { id, ok: false, diags, ms: Math.round(performance.now() - t0) };
    }
  }
  const mm = missingModule(diags);
  if (mm) {
    const where = locateInstance(tree, mm.module, mm.cell);
    diags = [missingModuleDiag(mm, tree, where), ...diags.filter((d) => !/is not part of the design/.test(d.text))];
  }
  diags = implicitNames(promoteDrivers(diags, str(r.out[sc.preflight]), tree), tree);
  if (!r.ok || diags.some((d) => d.kind === 'error')) {
    if (!diags.some((d) => d.kind === 'error')) diags.push({ kind: 'error', text: r.err || 'yosys failed without a message' });
    return { id, ok: false, diags, ms: Math.round(performance.now() - t0) };
  }
  diags.push(...preflightDiagnostics(str(r.out[sc.preflight]), tree));
  if (diags.some(d => d.kind === 'error')) return { id, ok: false, diags, ms: Math.round(performance.now() - t0) };
  const prints = printCount(str(r.out[sc.print]));
  if (prints) diags.push(printNote(prints));
  return { id, ok: true, json: str(r.out[sc.out]), timingHints: timingHints(str(r.out[sc.preflight])), diags, reader, ms: Math.round(performance.now() - t0), tree, names, top, dirs, sc };
}

// Validate before publishing a runnable circuit: DONE cannot precede this result.
// two runs, as the command line: the reader run (the same reader the build used, without -DSIM) elaborates and
// writes rtlil; the synthesis run reads only that rtlil, so synth_xilinx's cell library never meets the sources.
async function check(res) {
  const { tree, names, top, dirs, sc } = res;
  const keep = (ds) => ds.filter(d => d.kind !== 'text' || /^\s{2,}/.test(d.text));
  // slang prints its diagnostics only without -q, so its run is not quiet and its plain log lines are dropped
  const a = res.reader === 'slang'
    ? await yosys(['-p', checkReadScript(names, 'slang', top, dirs, sc)], slangTree(tree, names, dirs, sc))
    : await yosys(['-q', '-p', checkReadScript(names, 'yosys', top, dirs, sc)], tree);
  const adiags = res.reader === 'slang' ? parseLog(a.log).filter(d => d.kind !== 'text') : keep(parseLog(a.log));
  const diags = implicitNames(promoteDrivers(adiags, str(a.out[sc.preflight]), tree), tree);
  if (!a.ok) {
    if (!diags.some(d => d.kind === 'error')) diags.push({ kind: 'error', text: a.err || 'hardware validation failed without a message' });
    return { ok: false, diags };
  }
  diags.push(...preflightDiagnostics(str(a.out[sc.preflight]), tree));
  const b = await yosys(['-q', '-p', checkSynthScript(top, sc)], { [sc.il]: str(a.out[sc.il]) });
  diags.push(...keep(implicitNames(promoteDrivers(parseLog(b.log), str(a.out[sc.preflight]), tree), tree)));
  if (!b.ok && !diags.some(d => d.kind === 'error')) diags.push({ kind: 'error', text: b.err || 'hardware validation failed without a message' });
  return { ok: b.ok && !diags.some(d => d.kind === 'error'), diags };
}

// build, then validate; the result the page gets. when yosys' own reader accepted the code but the hardware
// check collided with synth_xilinx's cell library (a user module named INV, a unit-scope enum item named S0),
// the command line rebuilds with yosys-slang and accepts the design if that build passes: the simulator does
// the same, and keeps the first result otherwise.
const merge = (res, validation) => ({ ...res, ok: validation.ok, diags: [...res.diags, ...validation.diags].filter((d, i, all) => all.findIndex(o => o.kind === d.kind && o.text === d.text) === i) });
async function build(id, files, extra, top, cancelled = () => false) {
  let res;
  try { res = await compile(id, files, extra, top); }
  catch (err) { res = { id, ok: false, diags: [{ kind: 'error', text: String((err && err.message) || err) }], ms: 0 }; }
  if (!res.ok || cancelled()) return res;
  try {
    let validation = await check(res);
    if (!validation.ok && res.reader === 'yosys' && libraryClash(validation.diags) && !guardCode(validation.diags) && !cancelled()) {
      const again = await compile(id, files, extra, top, true);
      if (again.ok && !cancelled()) {
        const v2 = await check(again);
        if (v2.ok) { res = again; validation = v2; }
      }
    }
    return merge(res, validation);
  } catch (err) { return { id, ok: false, diags: [{ kind: 'error', text: `hardware validation failed: ${String(err.message || err)}` }] }; }
}

// a request is {id: number, kind, files: {name: text}, extra?: {name: text}, top?: string}; anything else is answered, not run
const textMap = (o) => o != null && typeof o === 'object' && !Array.isArray(o) && Object.values(o).every((t) => typeof t === 'string');
self.onmessage = (e) => {
  const { id, kind, files, extra, top } = e.data || {};
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  if (kind !== 'warm' && (!textMap(files) || (extra != null && !textMap(extra)) || (top != null && typeof top !== 'string'))) {
    self.postMessage({ id, ok: false, diags: [{ kind: 'error', text: 'error: the simulator got a malformed request (files must be names mapped to text)' }] });
    return;
  }
  if (kind === 'warm') { queue = queue.then(async () => { await warmUp(); self.postMessage({ id, ok: true }); }); return; }
  // lint: same compile + hardware validation as a run, but it never claims `latest`, so it neither
  // cancels an in-flight run nor gets cancelled by one. the caller drops stale replies by id.
  if (kind === 'lint') {
    queue = queue.then(async () => {
      await warmUp();
      const { json, tree, names, top: selectedTop, dirs, sc, ...msg } = await build(id, files, extra, top);
      self.postMessage({ ...msg, lint: true });
    });
    return;
  }
  latest = id;
  queue = queue.then(async () => {
    await warmUp();
    const { tree, names, top: selectedTop, dirs, sc, ...msg } = await build(id, files, extra, top, () => latest !== id);
    self.postMessage(latest === id ? msg : { id, ok: false, cancelled: true, diags: [] });
  });
};
