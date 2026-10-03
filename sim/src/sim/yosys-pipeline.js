// pure helpers for the yosys worker: the scripts it runs and the way its log is read. no dom, no wasm, so
// node can test them without starting a browser. the reader order follows templates/Makefile (the command line):
//   1. yosys' own reader: .sv as SystemVerilog (read_verilog -sv), .v as Verilog-2005 (read_verilog), as Vivado reads them
//   2. when it refuses, yosys-slang reads the same files (--threads 1: the wasm build has no threads); every .v is
//      handed to slang as a wrapped copy (`begin_keywords "1364-2005" with a `line directive) placed beside the real
//      file under a scratch name, so it stays Verilog-2005, its relative `includes still resolve, and its diagnostics
//      keep the real file name and line
// after either reader: hierarchy -check (a missing module is an error, not a mystery cell), proc, check, and
// $display/$print cells are counted and dropped (no hardware; Vivado and the command line drop them too).
// every file the scripts write and every copy they add lives under one scratch token (scratchNames) that no user
// path contains, so a project file named out.json or foo.v.slang.v is neither overwritten nor read as a wrapper.
export const ERROR_URL = 'https://nosey-dewdrop.github.io/dewfpga/errors/';
export const MAX_LOG = 64 * 1024;       // longest log kept, bytes
export const MAX_LINES = 400;           // most lines handed to the page

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const q = (n) => '"' + n.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export function splitSources(names) {
  const sv = names.filter((n) => /\.sv$/i.test(n)), v = names.filter((n) => /\.v$/i.test(n));
  return { sv, v };
}

// the scratch names of one build, chosen against the names in the tree: the token is .dewfpga, or .dewfpga1,
// .dewfpga2 ... until no user path contains it. slangName(n, i) is the wrapped copy slang reads for the i-th
// source when it is a .v: beside the real file (so a relative `include resolves as before), never the real file.
export function scratchNames(keys = []) {
  let token = '.dewfpga', k = 0;
  while (keys.some((n) => String(n).includes(token))) token = `.dewfpga${++k}`;
  return {
    token, args: `${token}.args`, preflight: `${token}.preflight.json`, out: `${token}.out.json`, print: `${token}.print.txt`, il: `${token}.il`,
    slangName: (n, i) => (/\.v$/i.test(n) ? n.replace(/[^/]*$/, `${token}.${i}.v`) : n),
  };
}
export const wrapKeywords = (name, text) => `\`begin_keywords "1364-2005"\n\`line 1 "${name}" 0\n${text}\n\`end_keywords\n`;

// the generic lowering digitaljs runs: the same passes the simulator always used, with hierarchy -check and
// the $print count/delete added. the print file holds the count ("N objects.").
// Resolve submodule/interface connections before serializing for DigitalJS; JSON hierarchy loses interface aliases.
const lower = (sc) => [ 'setattr -unset always_comb', 'proc', `write_json ${sc.preflight}`, 'check', `tee -q -o ${sc.print} select -count t:$print`, 'delete t:$print',
  'opt_clean', 'fsm', 'memory', 'wreduce -memx', 'flatten -noscopeinfo', 'opt_clean', `write_json ${sc.out}`];
const hier = (top) => (top ? `hierarchy -check -top ${top}` : 'hierarchy -check -auto-top');

// the read commands of yosys' own reader, with or without -DSIM
const readVerilog = (names, dirs, defs) => {
  const inc = dirs.map(d => `-I ${q(d)}`).join(' ');
  const { sv, v } = splitSources(names);
  return [sv.length && `read_verilog -sv ${defs}${inc} ${sv.map(q).join(' ')}`, v.length && `read_verilog ${defs}${inc} ${v.map(q).join(' ')}`].filter(Boolean);
};
export function readVerilogScript(names, top, dirs = ['.'], sc = scratchNames(names)) {
  return [...readVerilog(names, dirs, '-DSIM '), hier(top), ...lower(sc)].join('; ');
}

// Slang receives Yosys tokens literally, including quote characters. Its command-file
// parser handles quoted paths correctly (https://sv-lang.com/user-manual.html#command-files).
// Keep paths out of the Yosys script and prefix relative source names so '-' is never an option.
export function slangArguments(names, dirs = ['.'], sc = scratchNames(names)) {
  return [...dirs.map(d => `-I${q('./' + d)}`), ...names.map((n, i) => q('./' + sc.slangName(n, i)))].join('\n') + '\n';
}
// the tree slang reads: the user's files untouched, a wrapped copy beside every .v, and the argument file, all
// under scratch names. built from the original tree, never from a tree another pass already added copies to.
export function slangTree(tree, names, dirs, sc) {
  const out = { ...tree };
  names.forEach((n, i) => { if (/\.v$/i.test(n)) out[sc.slangName(n, i)] = wrapKeywords(n, tree[n]); });
  out[sc.args] = slangArguments(names, dirs, sc);
  return out;
}
export function readSlangScript(names, top, dirs = ['.'], sc = scratchNames(names)) {
  return [`read_slang --threads 1 -DSIM -f ${sc.args}`, hier(top), ...lower(sc)].join('; ');
}

// the validation pass: what synth_xilinx (the command line's synthesis) says about the same design, up to lut
// mapping, read without -DSIM as the command line reads it. the circuit starts only after validation succeeds;
// abc9 and place-and-route are not run. two yosys runs, as templates/Makefile: the reader run elaborates the
// design and writes it as rtlil; the synthesis run reads only that rtlil. synth_xilinx loads its cell library
// (cells_sim.v) through the same frontend, so in one run a user module named like a library primitive (INV, LUT1)
// or a unit-scope enum item named like a library parameter (S0) collided with the library; a separate run cannot.
export function checkReadScript(names, reader, top, dirs = ['.'], sc = scratchNames(names)) {
  const read = reader === 'slang' ? [`read_slang --threads 1 -f ${sc.args}`] : readVerilog(names, dirs, '');
  return [...read, hier(top), 'setattr -unset always_comb', 'proc', `write_json ${sc.preflight}`, 'delete t:$print', `write_rtlil ${sc.il}`].join('; ');
}
export function checkSynthScript(top, sc) {
  return [`read_rtlil ${sc.il}`, `synth_xilinx -flatten -nobram -arch xc7 -run begin:map_luts${top ? ` -top ${top}` : ''}`, 'check -noinit'].join('; ');
}
// the hardware check refused the design because synth_xilinx's cell library collided with a user name; the
// command line then rebuilds with yosys-slang (which elaborates from the top and leaves the user's own module
// out of the rtlil), so the simulator does the same
export const libraryClash = (diags) => diags.some((d) => d.kind === 'error' && /\/share\//.test(d.file || d.text) && /Re-definition of module|already exists/.test(d.text));
// the command line never retries a build its driver guards refused
export const guardCode = (diags) => diags.some((d) => d.kind === 'error' && /\[(empty-module|always-and-assign|two-always-drivers|two-assign-drivers|multiple-drivers)\]/.test(d.text));

// one log line -> {kind, file, line, col, text}. yosys: "file:line: ERROR: msg", "ERROR: msg", "Warning: msg";
// slang: "file:line:col: error: msg" (the caret line that follows is dropped). noise (banners, "Build failed",
// "see full log") is dropped. kind is error|warning|note|text.
export function parseLine(raw) {
  const l = stripAnsi(raw).replace(/\r$/, '').replace(/\/work\//g, '');
  if (!l.trim()) return null;
  if (/^-- (Running|Executing)/.test(l) || /^\d+\. Executing /.test(l) || /^Build failed: /.test(l) || /^\s*[\^~]+\s*$/.test(l)) return null;
  if (/^ERROR: Design elaboration failed; see full log/.test(l)) return null;
  if (/^Warning: Feature 'write_xaiger2' is experimental/.test(l)) return null;
  let m;
  if ((m = /^(.+?):(\d+):(\d+): (error|fatal error|warning|note): (.*)$/.exec(l))) return { kind: m[4] === 'warning' ? 'warning' : m[4] === 'note' ? 'note' : 'error', file: m[1], line: +m[2], col: +m[3], text: `${m[1]}:${m[2]}:${m[3]}: ${m[4] === 'fatal error' ? 'error' : m[4]}: ${m[5]}` };
  if ((m = /^(.+?):(\d+): (ERROR|Warning|warning|error): (.*)$/.exec(l))) return { kind: /^e/i.test(m[3]) ? 'error' : 'warning', file: m[1], line: +m[2], text: `${m[1]}:${m[2]}: ${/^e/i.test(m[3]) ? 'error' : 'warning'}: ${m[4]}` };
  if ((m = /^\s*(ERROR|Warning|warning|error): (.*)$/.exec(l))) return { kind: /^e/i.test(m[1]) ? 'error' : 'warning', text: `${/^e/i.test(m[1]) ? 'error' : 'warning'}: ${m[2]}` };
  return { kind: 'text', text: l };
}

export function parseLog(text) {
  const out = [];
  for (const raw of String(text).slice(-MAX_LOG).split('\n')) { const d = parseLine(raw); if (d) out.push(d); }
  // a "Warning: multiple conflicting drivers" line is followed by indented driver lines; keep them with it
  return out.slice(0, MAX_LINES);
}

// yosys' own reader refused the code in a way the second reader may resolve: a parser error (file:line: ERROR)
// or a frontend error. a missing module or an error after reading is not a reason to read again.
export function slangMayHelp(diags) {
  const errs = diags.filter((d) => d.kind === 'error');
  if (!errs.length) return false;
  if (errs.some((d) => /is not part of the design|Module .* referenced in module/.test(d.text))) return false;
  return errs.some((d) => d.file != null || /syntax error|unexpected|Identifier|implicitly declared|Unsupported|not supported|unsupported/i.test(d.text));
}

// `Module `\foo' referenced in module `\top' in cell `\u0' is not part of the design.` -> {module, parent, cell}
export function missingModule(diags) {
  for (const d of diags) {
    const m = /Module `\\?([^']+)' referenced in module `\\?([^']+)' in cell `\\?([^']+)' is not part of the design/.exec(d.text);
    if (m) return { module: m[1], parent: m[2], cell: m[3] };
  }
  return null;
}

// find the line that instantiates `module` (optionally as instance `cell`) in the given {name: text} sources.
// returns {file, line} only when exactly one line fits; otherwise null (the page then says it is not located).
export function locateInstance(files, module, cell) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = new RegExp(`^\\s*${esc(module)}\\s*(#\\s*\\(|[A-Za-z_])`);
  const hits = [];
  for (const [name, text] of Object.entries(files)) {
    if (!/\.(sv|v)$/i.test(name)) continue;
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) if (head.test(lines[i]) && !/^\s*(module|typedef|input|output|wire|logic|reg)\b/.test(lines[i])) hits.push({ file: name, line: i + 1, text: lines[i] });
  }
  if (hits.length === 1) return { file: hits[0].file, line: hits[0].line };
  if (cell) { const named = hits.filter((h) => new RegExp(`\\b${esc(cell)}\\b`).test(h.text)); if (named.length === 1) return { file: named[0].file, line: named[0].line }; }
  return null;
}

// the command line's wording (templates/Makefile, docs/errors.md module-not-found), with the location when found
export function missingModuleDiag(mm, files, where) {
  const given = Object.keys(files).filter((n) => /\.(sv|v)$/i.test(n)).join(' ');
  const at = where ? `${where.file}:${where.line}: ` : '';
  const text = `${at}error [module-not-found]: the module ${mm.module} is instantiated here${where ? '' : ` (as ${mm.cell} in ${mm.parent}; the line is not located in your files)`}, and no file the build was given declares it (dewfpga reads the files that hold a module: ${given}). Fix: put the file that declares ${mm.module} in this folder, or check the spelling of the module name. ${ERROR_URL}module-not-found/`;
  return { kind: 'error', file: where && where.file, line: where && where.line, text };
}

export const printNote = (n) => ({ kind: 'note', text: `note: ${n} $display call${n === 1 ? '' : 's'} in synthesizable code dropped: $display has no hardware; Vivado drops it silently, so it is dropped here too (it still prints in the testbench view).` });
export const slangNote = (top) => ({ kind: 'note', text: `note [read-with-slang]: ${top || 'the design'} read with yosys-slang, the second reader (yosys' own reader refused this code; the build is the same from here). ${ERROR_URL}read-with-slang/` });
export const vNote = () => ({ kind: 'note', text: `note [v-is-verilog-2005]: a .v file is read as Verilog-2005 by both readers, as Vivado reads it (UG901 Ch.10): SystemVerilog (logic, always_ff, always_comb, enum ...) belongs in a .sv file. Fix: if your .v file holds SystemVerilog, rename it to .sv. ${ERROR_URL}v-is-verilog-2005/` });

// "N objects." -> N
export const printCount = (t) => { const m = /(\d+) objects?/.exec(String(t || '')); return m ? +m[1] : 0; };

// multiple conflicting drivers: the command line stops the build here and says which writers conflict
// (templates/Makefile, classify/mdend); the simulator does the same. each driver cell is placed at its source
// line (the cell's src attribute in the post-proc netlist, or the file:line in a $ternary$file:line$n name), and the
// other writes of the same signal in that file are added, then:
//   an always block and an assign -> always-and-assign; two always blocks -> two-always-drivers;
//   two assigns (or an assign and a 'z assign) -> two-assign-drivers; only 'z assigns -> warning tristate-to-logic
//   (a tri bus inside the chip is built as logic, as Vivado does); a 'z bus on an inout pin of the top is left alone.
const ALWAYS_LINE = /(^|[^A-Za-z0-9_])always(_ff|_comb|_latch)?([^A-Za-z0-9_]|$)|^\s*(initial|assign)[^A-Za-z0-9_]/;
const lhsOf = (s) => { const m = /(^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])*\s*<?=[^=]/.exec(s || ''); return m ? m[2] : ''; };
function cellPlaces(netlist) {
  const at = new Map(), inout = new Set();
  let j = null; try { j = JSON.parse(netlist || 'null'); } catch { j = null; }
  for (const m of Object.values((j && j.modules) || {})) {
    for (const [n, c] of Object.entries(m.cells || {})) { const src = String((c.attributes && c.attributes.src) || '').split('|')[0]; const p = /^(.+):(\d+)\.\d+/.exec(src) || /^(.+):(\d+)$/.exec(src); if (p) at.set(n, `${p[1]}:${p[2]}`); }
    if (m.attributes && Number(m.attributes.top) === 1) for (const [n, p] of Object.entries(m.ports || {})) if (p.direction === 'inout') inout.add(n);
  }
  return { at, inout };
}
export function promoteDrivers(diags, netlist = '', files = {}) {
  const out = []; let i = 0;
  const { at, inout } = cellPlaces(netlist);
  const lineOf = (place) => { const [, f, n] = /^(.+):(\d+)$/.exec(place) || []; return f && files[f] != null ? String(files[f]).split('\n')[n - 1] || '' : ''; };
  const done = new Set();
  while (i < diags.length) {
    const d = diags[i];
    const m = /^warning: multiple conflicting drivers for (.+?):?$/.exec(d.text);
    if (!m) { out.push(d); i++; continue; }
    const wire = m[1].replace(/^[^.$]*\.\\?/, '').replace(/ \[\d+\]$/, '');
    const drivers = []; i++;
    while (i < diags.length && diags[i].kind === 'text' && /^\s{2,}/.test(stripAnsi(diags[i].text)) ) { drivers.push(diags[i].text.trim()); i++; }
    if (/\$iopadmap/.test(wire)) continue;
    const places = [];
    for (const t of drivers) {
      const c = /of cell (\S+)/.exec(t); if (!c) continue;
      const p = at.get(c[1]) || at.get(c[1].replace(/^\\/, '')) || (/^\$\w+\$(.+:\d+)\$\d+$/.exec(c[1]) || [])[1];
      if (p && !places.includes(p)) places.push(p);
    }
    let sig = wire; for (const p of places) { const h = lhsOf(lineOf(p)); if (h) sig = h; }
    if (done.has(sig)) continue;
    done.add(sig);
    // no source line for any driver: every driver a ?: mux may be a tri bus, so the raw warning stays; anything else stops
    if (!places.length && drivers.length && drivers.every((t) => /\(\$mux\)$/.test(t))) { out.push(d, ...drivers.map((t) => ({ kind: 'text', text: `    ${t}` }))); continue; }
    const zl = [], al = [], bl = [], seen = new Set(), add = (l, x) => { if (!l.includes(x)) l.push(x); };
    const classify = (p) => {
      if (seen.has(p)) return; seen.add(p);
      const s = lineOf(p);
      if (/^\s*assign\s/.test(s)) { add(/'[sS]?[bBoOhH]?[zZ]/.test(s) ? zl : al, p); return; }
      const [, f, n] = /^(.+):(\d+)$/.exec(p); const ls = String(files[f] || '').split('\n');
      for (let k = +n - 1; k >= 0; k--) if (ALWAYS_LINE.test(ls[k])) { if (/always/.test(ls[k])) add(bl, `${f}:${k + 1}`); return; }
    };
    places.forEach(classify);
    const sf = places.length ? places[0].replace(/:\d+$/, '') : '';
    if (sf && files[sf] != null && sig !== wire) {
      const w = new RegExp(`(^|[^A-Za-z0-9_.])${sig}\\s*(\\[[^\\]]*\\])*\\s*<?=[^=]`), decl = /^\s*(logic|reg|wire|integer|bit|localparam|parameter|genvar|for)[^A-Za-z0-9_]/;
      String(files[sf]).split('\n').forEach((l, k) => { if (w.test(l) && !decl.test(l)) classify(`${sf}:${k + 1}`); });
    }
    const byLine = (x, y) => x.replace(/:\d+$/, '').localeCompare(y.replace(/:\d+$/, '')) || +x.split(':').pop() - +y.split(':').pop();
    for (const l of [zl, al, bl, places]) l.sort(byLine);
    const and = (l) => l.join(' and ');
    const coded = (kind, code, where, msg, fix) => { const [, f, n] = /^(.+):(\d+)$/.exec(where[0] || '') || []; return { kind, file: f, line: f ? +n : undefined, text: `${f ? `${f}:${n}: ` : ''}${kind} [${code}]: ${msg} Fix: ${fix} ${ERROR_URL}${code}/` }; };
    const bad = ' yosys resolved the conflict to a constant, so the board would not do what the simulation showed.';
    if (al.length && bl.length) out.push(coded('error', 'always-and-assign', [...al, ...bl], `${sig} is written by an always block (${and(bl)}) and by a continuous assign (${and(al)}):${bad}`, `drive ${sig} from one of them: keep the assign and delete the always block, or move the expression into the always block and delete the assign.`));
    else if (bl.length > 1) out.push(coded('error', 'two-always-drivers', bl, `${sig} is written from two always blocks (${and(bl)}):${bad}`, `drive ${sig} from one always block (merge the two, or give each block its own signal).`));
    else if (al.length > 1 || (al.length && zl.length)) out.push(coded('error', 'two-assign-drivers', [...al, ...zl], `${sig} is written by two continuous assigns (${and([...al, ...zl])}):${bad}`, `drive ${sig} from one assign (select with a mux:  assign ${sig} = sel ? b : a;).`));
    else if (zl.length && !al.length && !bl.length) {
      if (inout.has(sig)) { out.push(d, ...drivers.map((t) => ({ kind: 'text', text: `    ${t}` }))); continue; }
      out.push(coded('warning', 'tristate-to-logic', zl, `${sig} has two tri-state drivers (a z, at ${and(zl)}${zl.length === 1 ? ', one assign in a generate loop, one driver per iteration' : ''}) and is not an inout pin of the top module: the chip has tri-state buffers on its pins only, so yosys built the two drivers as logic, as Vivado does (UG901 Ch.5 Tristates). On the board ${sig} is never z: with no driver on it shows one driver's value, with both on the other's, where the simulation shows z and x.`, `select with a mux instead, so the simulation shows what the board does:  assign ${sig} = sel ? b : a;  and keep z for an inout pin only.`));
    }
    else out.push(coded('error', 'multiple-drivers', places, `${sig} is written from more than one place (${and(places) || drivers.join('; ') || 'two drivers'}):${bad}`, `drive ${sig} from one always block or one assign; give each other writer its own signal.`));
  }
  return out;
}

// an identifier yosys' reader declared on its own (`Identifier `\x' is implicitly declared`) that nothing drives
// (`Wire top.\x is used but has no driver`) is a 1-bit wire stuck at x: the command line refuses it, so does the
// simulator, with the command line's reason. one that something drives (an implicit net on an instance port) stays a warning.
export function implicitNames(diags, files = {}) {
  const implicit = new Map(), undriven = new Set();
  for (const d of diags) {
    let m = /Identifier `\\?(.+?)' is implicitly declared/.exec(d.text);
    if (m && !implicit.has(m[1])) implicit.set(m[1], d);
    if ((m = /Wire .+?\.\\(.+?) is used but has no driver/.exec(d.text))) undriven.add(m[1]);
  }
  const src = Object.values(files).map(String).join('\n');
  const packages = new Set([...src.matchAll(/^[ \t]*package\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]));
  const interfaces = [...src.matchAll(/^[ \t]*interface\s+(?:automatic\s+)?([A-Za-z_]\w*)/gm)].map((m) => m[1]);
  const coded = (d, code, msg, fix) => ({ kind: 'error', file: d.file, line: d.line, text: `${d.file != null ? `${d.file}:${d.line}: ` : ''}error [${code}]: ${msg} Fix: ${fix} ${ERROR_URL}${code}/` });
  const replace = new Map(), drop = new Set();
  for (const d of diags) {
    const m = /Package `\\?(.+?)' not found/i.exec(d.text);
    if (m && !packages.has(m[1])) replace.set(d, coded(d, 'package-not-found', `import ${m[1]}::* names the package ${m[1]}, and no file in this folder declares it (package ${m[1]}; ... endpackage).`, `check the spelling, or add the file that declares it (a package file is read before the files that use it).`));
  }
  for (const [name, d] of implicit) {
    if (!undriven.has(name)) continue;
    let e;
    const pk = /^(\w+)::(\w+)$/.exec(name), dot = /^([A-Za-z_]\w*)\.(.+)$/.exec(name);
    if (pk && !packages.has(pk[1])) e = coded(d, 'package-not-found', `${name} names the package ${pk[1]}, and no file in this folder declares it (package ${pk[1]}; ... endpackage).`, `check the spelling, or add the file that declares it (a package file is read before the files that use it).`);
    else if (dot && interfaces.some((i) => new RegExp(`\\b${i}\\s+(?:#\\s*\\([^;]*?\\)\\s*)?${dot[1]}\\b`).test(src))) e = coded(d, 'interface-member', `${name} is a member of the interface instance ${dot[1]}, used in the module that instantiates it. yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); an interface used this way is not supported yet.`, 'pass the interface to a module through an interface port, or keep those signals as plain logic in the module.');
    else if (dot) e = coded(d, 'hierarchical-name', `${name} is a hierarchical name (a signal inside another instance). yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); Vivado resolves hierarchical names (UG901 Ch.9 Table 20).`, 'bring that signal out through an output port of its module and connect it here.');
    else if (!pk) e = coded(d, 'undeclared-name', `${name} is not declared anywhere and nothing drives it: yosys made it a 1-bit wire stuck at x and built the design without it (dewfpga sim refuses this code).`, 'declare it, or check the spelling (a typo of a declared name).');
    if (!e) continue;
    replace.set(d, e);
    for (const o of diags) if (o !== d && (new RegExp(`Wire .+?\\.\\\\${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} is used but has no driver`).test(o.text) || (o.text.includes(`\`\\${name}'`) && /implicitly declared/.test(o.text)))) drop.add(o);
  }
  return diags.filter((d) => !drop.has(d)).map((d) => replace.get(d) || d);
}

// Inspect cells before synthesis can replace unsupported asynchronous loads with mux/FF emulation.
// This is the same boundary the native CLI guards in its post-proc RTLIL.
export function preflightDiagnostics(json, files = {}) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  if (!obj || !obj.modules) throw new Error('missing post-proc netlist for hardware validation');
  const out = [], seen = new Set();
  for (const module of Object.values(obj.modules)) for (const cell of Object.values(module.cells || {})) {
    const asyncLoad = /^\$aldffe?$/.test(cell.type);
    const latch = /^\$[a]?dlatch$/.test(cell.type);
    if (!asyncLoad && !latch) continue;
    if (asyncLoad && Array.isArray(cell.connections.AD) && cell.connections.AD.every((bit) => bit === '0' || bit === '1')) continue;
    const source = String(cell.attributes?.src || '').split('|').map(s => /^(.+):(\d+)(?:\.\d+)?(?:-(\d+)(?:\.\d+)?)?$/.exec(s)).find(Boolean);
    const file = source?.[1], line = source ? Number(source[2]) : null;
    if (latch && file && /\balways_latch\b/.test((files[file] || '').split('\n').slice(line - 1, Number(source[3] || line)).join('\n'))) continue;
    const q = cell.connections.Q || [];
    const names = Object.entries(module.netnames || {}).filter(([,n]) => !n.hide_name && JSON.stringify(n.bits) === JSON.stringify(q)).map(([n]) => n);
    const signal = names[0] || 'this signal';
    const code = asyncLoad ? 'async-reset-nonconst' : 'latch';
    const key = `${code}:${file}:${line}:${signal}`;
    if (seen.has(key)) continue; seen.add(key);
    const kind = asyncLoad ? 'error' : 'warning';
    const message = asyncLoad
      ? `${signal} loads a signal or expression on an asynchronous reset edge. The chip has constant asynchronous set/reset, and synthesis would emulate this load with flip-flops and a mux. Fix: reset to a constant and load the value on a clock edge.`
      : `${signal} retains its previous value on an unassigned path, so a latch is inferred. Fix: assign every path for combinational logic, or use always_latch if the latch is intended.`;
    out.push({ kind, ...(file ? { file, line } : {}), text: `${file ? `${file}:${line}: ` : ''}${kind} [${code}]: ${message} ${ERROR_URL}${code}/` });
  }
  return out;
}

// Find large compare thresholds (c == N, c >= N, c < N, ...) on a register that increments by one. This is a
// timing hint, not proof that an output toggles: an enable/reset may delay it further.
export function timingHints(json) {
  const obj = typeof json === 'string' ? JSON.parse(json) : json;
  const hints = [], seen = new Set();
  const constant = (bits) => Array.isArray(bits) && bits.length <= 52 && bits.every(b => b === '0' || b === '1') ? bits.reduce((n,b,i) => n + (b === '1' ? 2 ** i : 0), 0) : null;
  const dynamic = (bits) => (bits || []).filter(b => typeof b === 'number');
  const same = (a,b) => a.length > 0 && a.length === b.length && a.every((v,i) => v === b[i]);
  for (const mod of Object.values(obj.modules || {})) {
    const cells = Object.values(mod.cells || {});
    const byOutput = new Map();
    for (const cell of cells) for (const [port, direction] of Object.entries(cell.port_directions || {})) {
      if (direction !== 'output') continue;
      for (const bit of dynamic(cell.connections[port])) {
        if (!byOutput.has(bit)) byOutput.set(bit,[]); byOutput.get(bit).push(cell);
      }
    }
    const cone = (starts) => {
      const found = new Set(), queue = [...starts];
      while(queue.length) {
        const bit=queue.pop(); if(found.has(bit))continue;found.add(bit);
        for(const cell of byOutput.get(bit) || []) {
          if (/dff|latch|\$mem/.test(cell.type))continue;
          for(const [port,direction] of Object.entries(cell.port_directions || {})) if(direction==='input')queue.push(...dynamic(cell.connections[port]));
        }
      }
      return found;
    };
    const incrementFor = (reg) => {
      const q=dynamic(reg.connections.Q), dependencies=cone(dynamic(reg.connections.D));
      return cells.find(c=>c.type==='$add' && dynamic(c.connections.Y).some(b=>dependencies.has(b)) && ((same(dynamic(c.connections.A),q) && constant(c.connections.B)===1) || (same(dynamic(c.connections.B),q) && constant(c.connections.A)===1)));
    };
    // a counter from 0 first flips the compare at N (c == N, c != N, c >= N, c < N) or at N+1 (c > N, c <= N);
    // a reload on that flip makes a period of flip+1 cycles. the constant may stand on either side.
    for (const eq of cells.filter(c => /^\$(eq|ne|ge|gt|le|lt)$/.test(c.type))) {
      let bits, threshold;
      for (const [a,b] of [['A','B'],['B','A']]) { const n=constant(eq.connections[b]); if(n !== null) { threshold=n+1+((a==='A'?/^\$(gt|le)$/:/^\$(ge|lt)$/).test(eq.type)?1:0);bits=dynamic(eq.connections[a]);break; } }
      if (!bits || threshold < 10000 || !Number.isSafeInteger(threshold)) continue;
      const reg=cells.find(c => /^\$[a-z]*dffe?$/.test(c.type) && same(dynamic(c.connections.Q),bits));
      if (!reg || !incrementFor(reg)) continue;
      const dependencies=cone(dynamic(reg.connections.D));
      if (!dynamic(eq.connections.Y).some(b=>dependencies.has(b))) continue;
      const signal=Object.entries(mod.netnames || {}).find(([,n]) => !n.hide_name && same(dynamic(n.bits),bits))?.[0] || 'counter';
      const src=/^(.+):(\d+)/.exec(String(eq.attributes?.src || '').split('|')[0]);
      const key=`${signal}:${threshold}:${src?.[1]}`; if(seen.has(key))continue;seen.add(key);
      hints.push({ signal,cycles:threshold,...(src?{file:src[1],line:Number(src[2])}:{}) });
      if(hints.length===4)return hints;
    }
    // Also cover the common free-running counter whose high bit drives a LED or divider.
    // Traverse only combinational cells; crossing a flip-flop would misidentify unrelated state.
    const visible=cone(Object.values(mod.ports || {}).filter(p=>p.direction==='output').flatMap(p=>dynamic(p.bits)));
    for(const reg of cells.filter(c=>/^\$[a-z]*dffe?$/.test(c.type))) {
      const q=dynamic(reg.connections.Q);
      if(!incrementFor(reg)) continue;
      let index=-1;for(let i=0;i<q.length;i++) if(visible.has(q[i])) index=i;
      if(index<14 || index>51)continue;
      const signal=Object.entries(mod.netnames || {}).find(([,n])=>!n.hide_name && same(dynamic(n.bits),q))?.[0] || 'counter';
      const src=/^(.+):(\d+)/.exec(String(reg.attributes?.src || '').split('|')[0]);
      if(hints.some(h=>h.signal===signal && h.file===src?.[1]))continue;
      hints.push({signal,kind:'bit',bit:index,cycles:2**index,...(src?{file:src[1],line:Number(src[2])}:{})});
      if(hints.length===4)return hints;
    }
  }
  return hints;
}
