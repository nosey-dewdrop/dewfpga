// the workspace model: files with free names and relative paths, the limits an import respects, the content-based
// top/testbench/xdc choice the command line makes (templates/check_xdc.py scan(): a testbench is a module with no
// ports, the top is the design module no other design module instantiates, never by file name), a folder/drop
// importer that keeps relative paths, and a source-only zip writer (PKWARE APPNOTE 6.3.x, method 0 "store", so the
// bytes come back exactly as they went in and `unzip` or Python's zipfile opens it; the CLI then runs on the folder).
export const EXTENSIONS = ['.sv', '.v', '.svh', '.vh', '.xdc', '.mem'];
export const LIMITS = { files: 256, fileBytes: 1048576, projectBytes: 8388608 };
const SOURCE = /\.(sv|v)$/i, HEADER = /\.(svh|vh)$/i, XDC = /\.xdc$/i, MEM = /\.mem$/i;
const SEGMENT = /^[A-Za-z0-9_.\-+@ ()\[\]]+$/;      // one path piece: no control characters, no separators

export const kindOf = (p) => SOURCE.test(p) ? 'source' : HEADER.test(p) ? 'header' : XDC.test(p) ? 'xdc' : MEM.test(p) ? 'mem' : null;
export const base = (p) => p.slice(p.lastIndexOf('/') + 1);
export const stem = (p) => base(p).replace(/\.[^.]+$/, '');

// null when the path is one the workspace keeps; otherwise the reason, in the student's words.
export function pathProblem(p) {
  if (typeof p !== 'string' || !p) return 'empty file name';
  if (p.includes('\0')) return 'file name contains a NUL byte';
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\')) return `${p}: absolute paths are not kept; the workspace is relative to the folder you opened`;
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '.' || s === '..')) return `${p}: a path may not contain "..", "." or empty segments`;
  if (segs.some((s) => !SEGMENT.test(s))) return `${p}: a file name may only use letters, digits, space, _ . - + @ ( ) [ ]`;
  if (!kindOf(p)) return `${p}: not a file the command line reads (${EXTENSIONS.join(' ')})`;
  return null;
}

// the import is all-or-nothing: one bad path, one file over the limit, one duplicate, and nothing changes.
// entries: [{path, bytes?: Uint8Array, text?: string}]. returns {files} or throws Error with every reason.
export function validateImport(entries, limits = LIMITS) {
  const problems = [], seen = new Set(); let total = 0;
  if (entries.length === 0) problems.push('no .sv, .v, .svh, .vh, .xdc or .mem file in what you opened');
  if (entries.length > limits.files) problems.push(`${entries.length} files; the workspace holds at most ${limits.files}`);
  for (const e of entries) {
    const why = pathProblem(e.path); if (why) { problems.push(why); continue; }
    const key = e.path.toLowerCase();
    if (seen.has(key)) problems.push(`${e.path}: the same path twice (names that differ only in case count as one, as on macOS)`);
    seen.add(key);
    const n = e.bytes ? e.bytes.byteLength : new TextEncoder().encode(e.text || '').byteLength;
    if (n > limits.fileBytes) problems.push(`${e.path}: ${n} bytes; one file may be at most ${limits.fileBytes} (1 MiB)`);
    total += n;
  }
  for (const name of seen) {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0,i).join('/'))) problems.push(`${name}: a file and folder have the same path`);
  }
  if (total > limits.projectBytes) problems.push(`${total} bytes in all; the workspace holds at most ${limits.projectBytes} (8 MiB)`);
  if (problems.length) { const err = new Error(problems.join('\n')); err.problems = problems; throw err; }
  return entries.map((e) => ({ ...toRecord(e.path, e.bytes, e.text), ...(Array.isArray(e.usage) ? { usage: e.usage.filter(u => u === 'design' || u === 'simulation') } : {}) }));
}

// a file record: path, text as the editor shows it (\n line ends), and what is needed to give the bytes back:
// the original bytes while the text is untouched, else the line ending and byte-order mark to re-encode with.
export function toRecord(path, bytes, text) {
  if (bytes) {
    const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    const decoded = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true }).decode(bytes);
    const s = bom ? decoded.slice(1) : decoded;
    return { path, text: s.replace(/\r\n?/g, '\n'), eol: /\r\n/.test(s) ? '\r\n' : /\r/.test(s) ? '\r' : '\n', bom, raw: bytes };
  }
  const s = text || '';
  return { path, text: s.replace(/\r\n?/g, '\n'), eol: /\r\n/.test(s) ? '\r\n' : /\r/.test(s) ? '\r' : '\n', bom: false, raw: null };
}
export function encodeRecord(r) {
  if (r.raw && r.raw.length !== undefined) return r.raw;
  const body = r.eol === '\n' ? r.text : r.text.replace(/\n/g, r.eol);
  return new TextEncoder().encode((r.bom ? '﻿' : '') + body);
}

// JSON persistence keeps untouched bytes too: otherwise reload silently changes BOM,
// mixed line endings or a byte sequence the editor decoded with a replacement character.
export function serializeRecords(records) {
  return records.map((r) => {
    let raw = null;
    if (r.raw) {
      let binary = '';
      for (let i = 0; i < r.raw.length; i += 8192) binary += String.fromCharCode(...r.raw.subarray(i, i + 8192));
      raw = btoa(binary);
    }
    return { path: r.path, text: r.text, eol: r.eol, bom: r.bom, raw, ...(r.usage ? { usage: r.usage } : {}) };
  });
}
export function restoreRecords(records) {
  if (!Array.isArray(records)) throw new Error('invalid saved workspace');
  return validateImport(records.map((r) => {
    if (!r || typeof r.text !== 'string') throw new Error('invalid saved file');
    if (typeof r.raw === 'string') {
      if (r.raw.length > Math.ceil(LIMITS.fileBytes / 3) * 4) throw new Error('saved file exceeds 1 MiB');
      const raw = atob(r.raw);
      return { path: r.path, usage: r.usage, bytes: Uint8Array.from(raw, (c) => c.charCodeAt(0)) };
    }
    return { path: r.path, usage: r.usage, bytes: encodeRecord({ text: r.text,
      eol: ['\n', '\r\n', '\r'].includes(r.eol) ? r.eol : '\n', bom: r.bom === true }) };
  }));
}

// ---- top / testbench / xdc, the command line's rule ---------------------
// comments and string bodies blanked to spaces, same offsets, newlines kept (check_xdc.py _blank)
export function blank(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"/g, (m) => m.replace(/[^\n]/g, ' '));
}
function headerIsTestbench(body) {
  // the header: everything to the first ';'. a module with no port list or an empty one is a testbench.
  const semi = body.indexOf(';'); let head = semi < 0 ? body : body.slice(0, semi);
  head = head.replace(/\bimport\b[^;]*?;/g, '');
  // drop one balanced #( ... ) parameter list
  const hash = head.indexOf('#');
  if (hash >= 0) {
    let depth = 0, i = head.indexOf('(', hash);
    if (i >= 0) { for (let j = i; j < head.length; j++) { if (head[j] === '(') depth++; else if (head[j] === ')' && --depth === 0) { head = head.slice(0, hash) + head.slice(j + 1); break; } } }
  }
  const open = head.indexOf('(');
  if (open < 0) return true;
  const close = head.lastIndexOf(')');
  return head.slice(open + 1, close < open ? undefined : close).trim() === '';
}
const MODULE = /\bmodule\s+([A-Za-z_]\w*)([\s\S]*?)\bendmodule\b/g;
// every module in the sources: {name, file, line, tb, body}; duplicates reported, first kept (module-defined-twice)
export function parseModules(files) {
  const mods = new Map(), problems = [];
  for (const f of files) {
    if (kindOf(f.path) !== 'source') continue;
    const src = blank(f.text);
    for (const m of src.matchAll(MODULE)) {
      const line = src.slice(0, m.index).split('\n').length;
      if (mods.has(m[1])) { const o = mods.get(m[1]); problems.push({ code: 'module-defined-twice', text: `module ${m[1]} is defined twice: ${o.file}:${o.line} and ${f.path}:${line}. Fix: keep one of them.` }); continue; }
      mods.set(m[1], { name: m[1], file: f.path, line, tb: headerIsTestbench(m[2]), body: m[2] });
    }
  }
  const inst = new Map();
  for (const [n, d] of mods) {
    inst.set(n, new Set());
    for (const other of mods.keys()) {
      if (other === n) continue;
      const re = new RegExp(`\\b${other}\\s*(?:#\\s*\\([^;]*?\\)\\s*)?(?:[A-Za-z_]\\w*\\s*(?:\\[[^\\]]*\\]\\s*)?)?\\(`, 'g');
      if (re.test(d.body)) inst.get(n).add(other);
    }
  }
  return { mods, inst, problems };
}
// the choice: {top, tb, xdc, tops, tbs, xdcs, error, why}. prefer = {top, xdc} the student picked when it was ambiguous.
export function resolve(files, prefer = {}) {
  const { mods, inst, problems: simulationProblems } = parseModules(files);
  const designParse = parseModules(files.filter(f => f.usage?.includes('design') !== false));
  const problems = designParse.problems;
  const order = [...mods.values()];
  const design = [...designParse.mods.values()].filter((d) => !d.tb), tbs = order.filter((d) => d.tb && files.find(f => f.path === d.file)?.usage?.includes('simulation') !== false);
  const used = new Set(); for (const d of design) for (const u of designParse.inst.get(d.name)) used.add(u);
  const roots = design.filter((d) => !used.has(d.name)).map((d) => d.name);
  const xdcs = files.filter((f) => kindOf(f.path) === 'xdc').map((f) => f.path);
  const out = { top: null, tb: null, xdc: null, tops: roots, tbs: tbs.map((d) => d.name), xdcs, error: null, why: '', topFile: null, tbFile: null };
  if (problems.length) { out.error = problems[0]; return out; }
  if (simulationProblems.length) out.tbError = simulationProblems[0];
  if (!design.length) { out.error = { code: 'no-design-module', text: `no design module${order.length ? ' (only testbenches)' : ''}. Fix: a design is a module with ports; put it in a .sv file.` }; return out; }
  if (prefer.project && prefer.top) {
    if (design.some(d => d.name === prefer.top)) { out.top = prefer.top; out.why = 'selected by the project'; }
    else { out.error = { code:'no-top-module', text:`the project selects ${prefer.top}, which is not an active design module. Fix: select an active top in the project.` }; return out; }
  }
  else if (roots.length === 1) out.top = roots[0];
  else if (prefer.top && roots.includes(prefer.top)) { out.top = prefer.top; out.why = 'your choice'; }
  else {
    const named = roots.filter((n) => xdcs.some((x) => stem(x) === n));
    if (named.length === 1) { out.top = named[0]; out.why = `named by ${named[0]}.xdc`; }
    else if (!roots.length) { out.error = { code: 'two-tops', text: `every design module instantiates another (a loop); nothing is the top. Fix: check the instances.` }; return out; }
    else { out.error = { code: 'two-tops', text: `${roots.length} modules could be the top (nothing instantiates them): ${roots.map((n) => `${n} (${designParse.mods.get(n).file}:${designParse.mods.get(n).line})`).join(', ')}. Fix: pick one above, or name it on the command line:  dewfpga bit ${roots[0]}` }; return out; }
  }
  out.topFile = designParse.mods.get(out.top).file;
  const tbFor = tbs.filter((d) => inst.get(d.name).has(out.top));
  const tb = tbs.find(d => d.name === prefer.tb) || tbFor[0] || (tbs.length === 1 ? tbs[0] : null);
  if (prefer.project && prefer.tb && !tbs.some(d => d.name === prefer.tb)) out.tbError = { code:'no-testbench', text:`the project selects ${prefer.tb}, which is not an active testbench. Fix: select an active simulation top in Vivado.` };
  if (tb) { out.tb = tb.name; out.tbFile = tb.file; }
  if (xdcs.length === 1) out.xdc = xdcs[0];
  else if (xdcs.length > 1) {
    const byName = xdcs.filter((x) => stem(x) === out.top);
    if (prefer.xdc && xdcs.includes(prefer.xdc)) out.xdc = prefer.xdc;
    else if (byName.length === 1) out.xdc = byName[0];
    else out.xdcError = { code: 'two-xdc-files', text: `${xdcs.length} .xdc files (${xdcs.join(', ')}) and none is named ${out.top}.xdc, so nothing says which one holds the pins. Fix: pick one above, or keep one, or name it ${out.top}.xdc.` };
  }
  return out;
}

// ---- import: a folder picker's FileList or a drop's DataTransfer -------
// relative paths are kept; the folder the student opened is the root (its own name stripped, as `cd lab5` would).
export function stripRoot(paths) {
  const first = paths.map((p) => p.split('/'));
  // Never turn an unsafe root into an apparently valid relative filename.
  const root = first[0]?.[0];
  if (root && root !== '.' && root !== '..' && !/^[A-Za-z]:$/.test(root)
      && first.every((s) => s.length > 1 && s[0] === root)) return paths.map((p) => p.slice(p.indexOf('/') + 1));
  return paths;
}
const SKIP = /(^|\/)(\.git|node_modules|\.Xil|\.sim|\.runs|\.cache|\.hw|\.ip_user_files|\.gen|\.srcs\/utils_1)(\/|$)/;
export function layoutNotes(paths) {
  const notes = [];
  if (paths.some((p) => /\.xpr$/i.test(p) || /\.srcs\//.test(p))) notes.push('Vivado layout: .xpr selects the active source sets; without an .xpr, sources_1, constrs_1 and sim_1 supply the project files.');
  return notes;
}
export async function entriesFromFileList(list) {
  const all = [...list].map((f) => ({ file: f, path: (f.webkitRelativePath || f.name).replace(/\\/g, '/') }));
  return finishEntries(all);
}
// Parse only source sets selected by synth_1 and ActiveSimSet, as the native XPR reader does.
// Resolution stays inside the chosen folder. External/missing references are refused atomically.
export function vivadoSelection(xmlText, projectPath, available, Parser = globalThis.DOMParser) {
  const fail = (message) => { throw new Error(`${projectPath}: ${message}`); };
  if (!Parser) fail('XML parser is unavailable');
  if (/<!DOCTYPE|<!ENTITY/i.test(xmlText)) fail('XML entities are not supported');
  const doc = new Parser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) fail('project XML could not be read');
  const types = ['DesignSrcs', 'Constrs', 'SimulationSrcs'];
  const sets = [...doc.querySelectorAll('FileSet')].filter(s => types.includes(s.getAttribute('Type')));
  const synth = [...doc.querySelectorAll('Run')].find(s => s.getAttribute('Id') === 'synth_1');
  const activeSim = [...doc.querySelectorAll('Option')].find(s => s.getAttribute('Name') === 'ActiveSimSet')?.getAttribute('Val') || '';
  const wanted = { DesignSrcs:synth?.getAttribute('SrcSet') || '', Constrs:synth?.getAttribute('ConstrsSet') || '', SimulationSrcs:activeSim };
  const selected = new Map(), prefer = { project: true }, included = new Map();
  for (const type of types) {
    const choices = sets.filter(s => s.getAttribute('Type') === type);
    if (!choices.length) continue;
    const matches = wanted[type] ? choices.filter(s => s.getAttribute('Name') === wanted[type]) : choices;
    if (matches.length !== 1) fail(`${type} has no unique active source set; select and save the active set in Vivado`);
    selected.set(type, matches[0]);
  }
  const parent = projectPath.includes('/') ? projectPath.slice(0, projectPath.lastIndexOf('/') + 1) : '';
  const name = base(projectPath).replace(/\.xpr$/i, '');
  const locate = (raw) => {
    const rel = raw.replaceAll('\\', '/').replaceAll('$PSRCDIR', name + '.srcs').replaceAll('$PPRDIR', '.');
    if (/^\$|^\/|^[A-Za-z]:/.test(rel)) fail(`unsupported external reference ${raw}; include the referenced file inside the project folder`);
    const parts = parent.split('/').filter(Boolean);
    for (const part of rel.split('/')) {
      if (part === '.' || !part) continue;
      if (part === '..') { if (!parts.length) fail(`reference escapes the opened folder: ${raw}`); parts.pop(); }
      else parts.push(part);
    }
    const path = parts.join('/');
    if (!available.has(path)) fail(`referenced file is missing: ${raw}`);
    return path;
  };
  for (const [type, set] of selected) {
    const top = [...set.querySelectorAll('Option')].find(o => o.getAttribute('Name') === 'TopModule')?.getAttribute('Val');
    if (top && type === 'DesignSrcs') prefer.top = top;
    if (top && type === 'SimulationSrcs') prefer.tb = top;
    for (const file of [...set.children].filter(e => e.tagName === 'File')) {
      if ([...file.querySelectorAll('Attr')].some(a => (a.getAttribute('Name') === 'AutoDisabled' && a.getAttribute('Val') === '1') || (a.getAttribute('Name') === 'IsEnabled' && ['0','FALSE','false'].includes(a.getAttribute('Val'))))) continue;
      const raw = file.getAttribute('Path') || '', kind = kindOf(raw);
      if (type === 'Constrs' ? kind !== 'xdc' : !['source','header','mem'].includes(kind)) continue;
      const path = locate(raw);
      const uses = included.get(path) || new Set();
      if (type === 'DesignSrcs') { uses.add('design'); uses.add('simulation'); }
      if (type === 'SimulationSrcs') uses.add('simulation');
      included.set(path, uses);
    }
  }
  // Includes and memory tables can be referenced by source text without a File entry.
  for (const path of available) if (['header','mem'].includes(kindOf(path)) && !included.has(path)) included.set(path,new Set(['design','simulation']));
  const constraints = [...included.keys()].filter(p => kindOf(p) === 'xdc');
  if (constraints.length === 1) prefer.xdc = constraints[0];
  return { included, prefer };
}
async function finishEntries(all) {
  const paths = stripRoot(all.map(e => e.path));
  const normalized = all.map((e,i) => ({ ...e, path:paths[i] })).filter(e => !SKIP.test(e.path));
  const projects = normalized.filter(e => /\.xpr$/i.test(e.path));
  if (projects.length > 1) throw new Error('more than one .xpr project was opened; open one project folder');
  let selection = null;
  if (projects.length) selection = vivadoSelection(await projects[0].file.text(),projects[0].path,new Set(normalized.map(e => e.path)));
  let srcsLayout = false;
  if (!selection) {
    const directSrcs = all.length && all.every(e => e.path.split('/')[0] === all[0].path.split('/')[0]) && /\.srcs$/.test(all[0].path.split('/')[0]);
    const layouts = new Set(normalized.map(e => /^(.*?[^/]+\.srcs)\/(sources_1|constrs_1|sim_1)\//.exec(e.path)?.[1]).filter(Boolean));
    if (layouts.size > 1) throw new Error('more than one .srcs project was opened; open one project folder');
    if (directSrcs || layouts.size) {
      srcsLayout = true;
      const prefix = directSrcs ? '' : [...layouts][0] + '/';
      const included = new Map();
      for (const e of normalized) {
        if (!e.path.startsWith(prefix)) continue;
        const set = e.path.slice(prefix.length).split('/')[0], kind = kindOf(e.path);
        if (set === 'sources_1' && ['source','header','mem'].includes(kind)) included.set(e.path,new Set(['design','simulation']));
        if (set === 'sim_1' && ['source','header','mem'].includes(kind)) included.set(e.path,new Set(['simulation']));
        if (set === 'constrs_1' && kind === 'xdc') included.set(e.path,new Set());
      }
      selection = { included, prefer:{project:true} };
    }
  }
  const kept = normalized.filter(e => kindOf(e.path) && (!selection || selection.included.has(e.path)));
  const entries = [];
  for (const e of kept) entries.push({ path:e.path, bytes:new Uint8Array(await e.file.arrayBuffer()), ...(selection ? { usage:[...selection.included.get(e.path)] } : {}) });
  return { entries, prefer:selection?.prefer || {}, notes:selection ? [srcsLayout ? 'project files read from sources_1, constrs_1 and sim_1 (.xpr absent)' : `active source sets read from ${projects[0].path}; disabled and inactive sources were excluded`] : [], skipped:all.length-kept.length };
}
export async function entriesFromDrop(dt) {
  // Capture both APIs while the drop event still owns its data. WebKit can expose
  // an entry for an in-memory File whose entry.file() fails with NotFoundError.
  // A direct File is authoritative for a loose file; entries are needed for folders.
  const items = [...(dt.items || [])].filter(it => !it.kind || it.kind === 'file')
    .map(it => ({ entry: it.webkitGetAsEntry?.(), file: it.getAsFile?.() }));
  if (!items.length) return finishEntries([...dt.files].map((f) => ({ file: f, path: f.name })));
  const all = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) { const file = await new Promise((res, rej) => entry.file(res, rej)); all.push({ file, path: prefix + entry.name }); return; }
    if (entry.isDirectory) {
      const reader = entry.createReader(); let batch;
      do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const e of batch) await walk(e, prefix + entry.name + '/'); } while (batch.length);
    }
  };
  for (const { entry, file } of items) {
    if (entry?.isDirectory) await walk(entry, '');
    else if (file) all.push({ file, path: file.name });
    else if (entry?.isFile) await walk(entry, '');
    else throw new Error('a dropped file could not be read; drop the files again or use open folder');
  }
  return finishEntries(all);
}

// Export a project file when a plain folder would lose paths or explicit choices.
// All original files remain byte-exact; the manifest selects the same design/top/XDC.
export function archiveRecords(records, prefer = {}) {
  const r = resolve(records, prefer);
  const needsProject = records.some((f) => f.path.includes('/') || f.usage) || r.tops.length > 1 || r.xdcs.length > 1 || r.tbs.length > 1;
  if (!needsProject) return records;
  // Saving is available even for broken code: unresolved choices remain unresolved in the manifest.
  const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const { mods } = parseModules(records);
  const tbOnly = new Set(records.filter((f) => kindOf(f.path) === 'source').filter((f) => {
    const ms = [...mods.values()].filter((m) => m.file === f.path);
    return f.usage?.includes('design') === false || (ms.length > 0 && ms.every((m) => m.tb));
  }).map((f) => f.path));
  const design = records.filter((f) => kindOf(f.path) === 'source' && !tbOnly.has(f.path));
  const benches = records.filter((f) => tbOnly.has(f.path));
  const set = (name, type, sources, top) => `    <FileSet Name="${name}" Type="${type}">\n` +
    sources.map((f) => `      <File Path="$PPRDIR/${xml(f.path)}"/>\n`).join('') +
    (top ? `      <Config><Option Name="TopModule" Val="${xml(top)}"/></Config>\n` : '') + '    </FileSet>\n';
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<Project>\n' +
    '  <Configuration><Option Name="ActiveSimSet" Val="sim_1"/></Configuration>\n  <FileSets>\n' +
    set('sources_1', 'DesignSrcs', design, prefer.project && prefer.top ? prefer.top : r.top) +
    set('constrs_1', 'Constrs', records.filter((f) => r.xdc ? f.path === r.xdc : kindOf(f.path) === 'xdc'), null) +
    set('sim_1', 'SimulationSrcs', benches, prefer.project && prefer.tb ? prefer.tb : r.tb) +
    '  </FileSets>\n  <Runs><Run Id="synth_1" SrcSet="sources_1" ConstrsSet="constrs_1"/></Runs>\n</Project>\n';
  return [...records, toRecord('dewfpga-workspace.xpr', null, manifest)];
}

// ---- zip, store method -------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zip(records, when = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [], central = []; let offset = 0;
  const u16 = (v, b, o) => b.setUint16(o, v, true), u32 = (v, b, o) => b.setUint32(o, v, true);
  for (const r of records) {
    const name = enc.encode(r.path), data = encodeRecord(r), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    u32(0x04034b50, lh, 0); u16(20, lh, 4); u16(0x0800, lh, 6); u16(0, lh, 8); u16(dosTime, lh, 10); u16(dosDate, lh, 12);
    u32(crc, lh, 14); u32(data.length, lh, 18); u32(data.length, lh, 22); u16(name.length, lh, 26); u16(0, lh, 28);
    const ch = new DataView(new ArrayBuffer(46));
    u32(0x02014b50, ch, 0); u16(20, ch, 4); u16(20, ch, 6); u16(0x0800, ch, 8); u16(0, ch, 10); u16(dosTime, ch, 12); u16(dosDate, ch, 14);
    u32(crc, ch, 16); u32(data.length, ch, 20); u32(data.length, ch, 24); u16(name.length, ch, 28); u16(0, ch, 30); u16(0, ch, 32);
    u16(0, ch, 34); u16(0, ch, 36); u32(0, ch, 38); u32(offset, ch, 42);
    parts.push(new Uint8Array(lh.buffer), name, data); central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  u32(0x06054b50, eocd, 0); u16(0, eocd, 4); u16(0, eocd, 6); u16(records.length, eocd, 8); u16(records.length, eocd, 10); u32(cdSize, eocd, 12); u32(offset, eocd, 16); u16(0, eocd, 20);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let i = 0;
  for (const p of all) { out.set(p, i); i += p.length; }
  return out;
}
