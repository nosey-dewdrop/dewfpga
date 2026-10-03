// source scans the command line runs before or beside yosys (templates/check_xdc.py, templates/Makefile), ported
// so the simulator refuses the same code with the same code and wording. no dom, no wasm: node tests them.
//   decl-init-reads-signal  `logic [3:0] sum = sw[3:0] + sw[7:4];` is a start value, not an adder (IEEE 1800-2017 6.8)
//   isunknown-in-design     $isunknown in a design module: the simulator shows 0, synth_xilinx folds it to 1
//   ref-argument            a ref argument: yosys refuses it, yosys-slang drops it (the caller's variable never changes)
// only design modules (a module with ports) are scanned; a testbench module is blanked out first.
import { ERROR_URL } from './yosys-pipeline.js';

const spaces = (t) => t.replace(/[^\n]/g, ' ');

// comments and the text of string literals blanked (the quotes stay), every newline kept: offsets and lines still map
export const blank = (src) => String(src).replace(/"(?:[^"\\\n]|\\.)*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
  (t) => (t[0] === '"' ? '"' + spaces(t.slice(1, -1)) + '"' : spaces(t)));

// the text synthesis reads: SYNTHESIS is defined, so `ifndef SYNTHESIS bodies and the `else of `ifdef SYNTHESIS
// are blanked. every other `ifdef is kept whole.
export function synthView(src) {
  const out = [], stack = []; let pos = 0;
  const dropped = () => stack.some((b) => !b[0]);
  for (const m of src.matchAll(/^[ \t]*`(ifdef|ifndef|elsif|else|endif)\b[ \t]*([A-Za-z_]\w*)?/gm)) {
    out.push(dropped() ? spaces(src.slice(pos, m.index)) : src.slice(pos, m.index)); pos = m.index;
    const [, d, name] = m;
    if (d === 'ifdef' || d === 'ifndef') { const kept = name === 'SYNTHESIS' ? d === 'ifdef' : true; stack.push([kept, kept && name === 'SYNTHESIS']); }
    else if (stack.length && d === 'elsif') { const top = stack[stack.length - 1], kept = !top[1]; stack[stack.length - 1] = [kept, top[1] || (kept && name === 'SYNTHESIS')]; }
    else if (stack.length && d === 'else') stack[stack.length - 1][0] = !stack[stack.length - 1][1];
    else if (stack.length) stack.pop();
  }
  out.push(dropped() ? spaces(src.slice(pos)) : src.slice(pos));
  return out.join('');
}

// every typedef as [start, end, name]; a struct/enum body holds `;` of its own, so the name follows the brace
export function typedefs(src) {
  const found = [];
  for (const m of src.matchAll(/\btypedef\b/g)) {
    let i = m.index + m[0].length, depth = 0;
    for (; i < src.length; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') depth--; else if (c === ';' && depth <= 0) break; }
    const nm = /([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*$/.exec(src.slice(m.index + m[0].length, i));
    if (nm) found.push([m.index, i + 1, nm[1]]);
  }
  return found;
}
const blankTypedefs = (text) => { for (const [a, b] of typedefs(text)) text = text.slice(0, a) + spaces(text.slice(a, b)) + text.slice(b); return text; };

const VAR_TYPES = 'logic|reg|bit|byte|shortint|int|integer|longint|time';
const KW = new Set('input output inout logic reg wire bit byte shortint int integer longint time signed unsigned var tri tri0 tri1 wand wor supply0 supply1 const static automatic parameter localparam genvar'.split(' '));
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// split on the commas outside (), [] and {}
export function splitCommas(s) {
  const out = []; let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) { const c = s[i]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; } }
  out.push(s.slice(start));
  return out;
}

function declNames(text, types) {
  const names = new Set();
  for (const m of text.matchAll(new RegExp(`\\b(?:${types})\\b([^;]*?)(?:;|$)`, 'g'))) {
    for (let piece of splitCommas(m[1].replace(/\[[^\]]*\]/g, ' '))) {
      piece = piece.split('=')[0];
      const ids = (piece.match(/[A-Za-z_]\w*/g) || []).filter((i) => !KW.has(i));
      if (ids.length) names.add(ids[ids.length - 1]);
    }
  }
  return names;
}

const diag = (file, line, kind, code, message, fix) => ({ kind, file, line, text: `${file}:${line}: ${kind} [${code}]: ${message} Fix: ${fix} ${ERROR_URL}${code}/` });
const lineAt = (src, off) => src.slice(0, off).split('\n').length;

// body: the synthesis view of the text between the module name and endmodule; off: its offset in the file
function declInitProblems(file, src, body, off, tdefs) {
  const semi = body.indexOf(';');
  const head = semi < 0 ? body : body.slice(0, semi), restOff = semi < 0 ? body.length : semi + 1, rest = body.slice(restOff);
  const ports = declNames(head.replace(/#\s*\([\s\S]*?\)/g, ''), 'input|output|inout');
  let scope = rest.replace(/\bfunction\b[\s\S]*?\bendfunction\b|\btask\b[\s\S]*?\bendtask\b/g, spaces);
  scope = blankTypedefs(scope).replace(/\b(?:parameter|localparam|genvar)\b[^;]*;/g, spaces);
  const signals = new Set([...ports, ...declNames(scope, `input|output|inout|${VAR_TYPES}|wire|tri|tri0|tri1|wand|wor`)]);
  const types = VAR_TYPES + (tdefs.length ? '|' + tdefs.map(escape).join('|') : '');
  const out = [];
  for (const m of scope.matchAll(new RegExp(`^[ \\t]*(?:${types})\\b((?:\\s*(?:signed|unsigned))?(?:\\s*\\[[^\\]]*\\])*)([^;]*);`, 'gmd'))) {
    for (const piece of splitCommas(m[2])) {
      const eq = piece.indexOf('=');
      if (eq < 0) continue;
      const name = piece.slice(0, eq).replace(/\[.*/s, '').trim(), expr = piece.slice(eq + 1).trim();
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      const e = expr.replace(/\d*'[sS]?[bBdDhHoO]\s*[0-9a-fA-FxXzZ_?]+|'[01xXzZ]|\$\w+|\w+::\w+/g, ' ');
      const reads = [...new Set(e.match(/[A-Za-z_]\w*/g) || [])].filter((i) => signals.has(i) && i !== name);
      if (!reads.length) continue;
      const line = lineAt(src, off + restOff + m.indices[2][0]);
      const others = scope.slice(0, m.index) + scope.slice(m.index + m[0].length);
      const isReg = new RegExp(`(?<![\\w.])${escape(name)}\\s*(?:\\[[^\\]]*\\]\\s*)*<?=(?!=)`).test(others);
      const fix = isReg ? `declare ${name} without the = part and load it in the always block that writes it, under its reset:  if (reset) ${name} <= ${expr};`
        : `write  assign ${name} = ${expr};  and declare ${name} without the = part.`;
      out.push(diag(file, line, 'error', 'decl-init-reads-signal', `\`${name} = ${expr}\` in a declaration is a start value, not a wire: it reads ${reads.join(', ')} once, at time 0 (IEEE 1800-2017 6.8; yosys makes it the power-up value, so the board never follows ${reads[0]}).`, fix));
    }
  }
  return out;
}

// {name: text} of the design sources -> diagnostics, in file order
export function scanSources(files) {
  const out = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!/\.(sv|v)$/i.test(file)) continue;
    const src = blank(String(raw)), synth = synthView(src), tdefs = typedefs(src).map((t) => t[2]);
    let design = src, synthDesign = synth;
    for (const m of src.matchAll(/\bmodule\s+([A-Za-z_]\w*)([\s\S]*?)\bendmodule\b/g)) {
      const body = m[2], head = body.split(';')[0];
      const hasPorts = /\)\s*$/.test(head) && /\(\s*[^\s)]/.test(head.replace(/#\s*\([\s\S]*?\)/g, ''));
      const off = m.index + m[0].length - 'endmodule'.length - body.length;
      if (!hasPorts) {   // a testbench: neither scan reads it
        design = design.slice(0, m.index) + spaces(m[0]) + design.slice(m.index + m[0].length);
        synthDesign = synthDesign.slice(0, m.index) + spaces(m[0]) + synthDesign.slice(m.index + m[0].length);
        continue;
      }
      out.push(...declInitProblems(file, src, synth.slice(off, off + body.length), off, tdefs));
    }
    for (const m of synthDesign.matchAll(/\$isunknown\s*\(/g))
      out.push(diag(file, lineAt(src, m.index), 'error', 'isunknown-in-design', '$isunknown in a design: on the board a signal is never x, so it is 0 there (and dewfpga sim shows 0); yosys folds it to the constant 1 instead, so the bitstream would not do what the simulation showed.', 'remove it from the design; $isunknown belongs in the testbench.'));
    const lines = design.split('\n');
    lines.forEach((l, i) => {
      if (!/(^|[(,])\s*ref\s+[A-Za-z_[]/.test(l)) return;
      const f = /(function|task)[^(]*\(/.exec(l);
      let fn = 'a function or task';
      if (f) { const w = l.slice(0, f.index + f[0].length - 1).trim().split(/\s+/).pop(); if (!/^(function|task)$/.test(w)) fn = `function ${w}`; }
      const a = l.replace(/^.*[(,]\s*ref\s+/, '').replace(/^\s*ref\s+/, '').replace(/[,)].*/, '').trim();
      out.push(diag(file, i + 1, 'error', 'ref-argument', `${fn} takes an argument by reference (ref ${a}): yosys does not read ref, and yosys-slang drops it, so the variable it is called with would never change on the board.`, 'pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);).'));
    });
  }
  return out;
}

// the files that declare a package, first: yosys' reader resolves pkg::NAME only after it has read the package,
// and Vivado orders a package before its users the same way. the order of every other file is kept.
export function packagesFirst(names, files) {
  const declares = (n) => /^[ \t]*package\s+[A-Za-z_]\w*/m.test(blank(String(files[n] || '')));
  return [...names.filter(declares), ...names.filter((n) => !declares(n))];
}
