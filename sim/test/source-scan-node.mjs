// node test/source-scan-node.mjs: the command line's source scans, package order, undeclared names and driver
// conflicts as the simulator now reports them. no browser, no wasm: synthetic yosys logs stand in for the reader.
import { scanSources, packagesFirst } from '../src/sim/source-scan.js';
import { parseLog, promoteDrivers, implicitNames } from '../src/sim/yosys-pipeline.js';

let failed = 0, passed = 0;
const check = (name, ok, got) => { if (ok) passed++; else { failed++; console.log(`FAIL ${name}: ${JSON.stringify(got)}`); } };
const codes = (ds) => ds.map((d) => (/\[([a-z-]+)\]/.exec(d.text) || [])[1] || d.kind);

// decl-init-reads-signal: the line of the declaration, also under a port list that spans lines
{
  const ds = scanSources({ 'top.sv': 'module top(\n  input logic [7:0] sw,\n  output logic [3:0] led\n);\n  logic [3:0] sum = sw[3:0] + sw[7:4];\n  assign led = sum;\nendmodule\n' });
  check('decl-init code', codes(ds).join() === 'decl-init-reads-signal', ds);
  check('decl-init line', ds[0] && ds[0].line === 5 && ds[0].text.startsWith('top.sv:5: error [decl-init-reads-signal]'), ds[0]);
  check('decl-init fix is an assign', ds[0] && /assign sum = sw\[3:0\] \+ sw\[7:4\];/.test(ds[0].text), ds[0]);
}
// a constant start value and a parameter read are not signals
{
  const ds = scanSources({ 'top.sv': 'module top #(parameter W = 4)(input logic clk, output logic [W-1:0] q);\n  logic [W-1:0] c = W + 4\'d1;\n  always_ff @(posedge clk) c <= c + 1;\n  assign q = c;\nendmodule\n' });
  check('constant start value passes', ds.length === 0, ds);
}
// a register with a start value read from a signal gets the reset fix
{
  const ds = scanSources({ 'top.sv': 'module top(input logic clk, input logic [3:0] d, output logic [3:0] q);\n  logic [3:0] r = d;\n  always_ff @(posedge clk) r <= r + 1;\n  assign q = r;\nendmodule\n' });
  check('register start value', ds.length === 1 && /if \(reset\) r <= d;/.test(ds[0].text), ds);
}
// $isunknown: refused in a design module, left alone in a testbench module and under `ifndef SYNTHESIS
{
  const design = scanSources({ 'top.sv': 'module top(input logic a, output logic y);\n  assign y = $isunknown(a);\nendmodule\n' });
  check('isunknown in design', codes(design).join() === 'isunknown-in-design' && design[0].line === 2, design);
  const tb = scanSources({ 'top.sv': 'module top(input logic a, output logic y);\n  assign y = a;\nendmodule\nmodule tb;\n  logic a, y;\n  top dut(.a(a), .y(y));\n  initial if ($isunknown(y)) $error("x");\nendmodule\n' });
  check('isunknown in testbench passes', tb.length === 0, tb);
  const guarded = scanSources({ 'top.sv': 'module top(input logic a, output logic y);\n  assign y = a;\n`ifndef SYNTHESIS\n  always @* assert (!$isunknown(a));\n`endif\nendmodule\n' });
  check('isunknown under ifndef SYNTHESIS passes', guarded.length === 0, guarded);
  const comment = scanSources({ 'top.sv': 'module top(input logic a, output logic y);\n  assign y = a; // $isunknown(a)\nendmodule\n' });
  check('isunknown in a comment passes', comment.length === 0, comment);
}
// ref arguments
{
  const ds = scanSources({ 'top.sv': 'module top(input logic clk, output logic [3:0] q);\n  function automatic void inc(ref logic [3:0] x);\n    x = x + 1;\n  endfunction\n  always_ff @(posedge clk) inc(q);\nendmodule\n' });
  check('ref argument', codes(ds).join() === 'ref-argument' && ds[0].line === 2 && /function inc .*\(ref logic \[3:0\] x\)/.test(ds[0].text), ds);
}
// a package file is read first; every other file keeps its place, and no name changes
{
  const files = { 'a_top.sv': 'module a_top; import p::*; endmodule\n', 'b.sv': 'module b; endmodule\n', 'z_pkg.sv': '// package q\npackage p;\n  localparam W = 4;\nendpackage\n' };
  const order = packagesFirst(Object.keys(files), files);
  check('package first', order.join() === 'z_pkg.sv,a_top.sv,b.sv', order);
  check('package in a comment does not count', packagesFirst(['x.sv'], { 'x.sv': '// package p;\nmodule x; endmodule\n' }).join() === 'x.sv', null);
}
// undeclared names: plain, package, interface member, hierarchical; a driven implicit net stays a warning
{
  const log = (name, mod = 'top') => `top.sv:4: Warning: Identifier \`\\${name}' is implicitly declared.\nWarning: Wire ${mod}.\\${name} is used but has no driver.\n`;
  const files = { 'top.sv': 'interface bus_if; logic v; endinterface\nmodule top(output logic y);\n  bus_if b();\n  assign y = cnt;\nendmodule\n' };
  const one = (name) => implicitNames(parseLog(log(name)), files);
  check('undeclared-name', codes(one('cnt')).join() === 'undeclared-name' && one('cnt')[0].text.startsWith('top.sv:4: error [undeclared-name]'), one('cnt'));
  check('package-not-found', codes(one('q::W')).join() === 'package-not-found', one('q::W'));
  check('interface-member', codes(one('b.v')).join() === 'interface-member', one('b.v'));
  check('hierarchical-name', codes(one('u.x')).join() === 'hierarchical-name', one('u.x'));
  const driven = implicitNames(parseLog('top.sv:4: Warning: Identifier `\\n1\' is implicitly declared.\n'), files);
  check('driven implicit net stays a warning', driven.length === 1 && driven[0].kind === 'warning', driven);
  const pkg = implicitNames(parseLog('top.sv:2: ERROR: Package `\\q\' not found\n'), files);
  check('Package not found', codes(pkg).join() === 'package-not-found', pkg);
}
// conflicting drivers: classified by the source line of each driver cell
{
  const conflict = (cells) => parseLog(`Warning: multiple conflicting drivers for top.\\y:\n${cells.map((c) => `    port Y[0] of cell ${c} ($mux)`).join('\n')}\n`);
  const run = (src, cells, netlist = '') => promoteDrivers(conflict(cells), netlist, { 'top.sv': src });
  const aa = run('module top(input logic a, b, s, output logic y);\n  assign y = s ? a : 1\'b0;\n  assign y = s ? 1\'b0 : b;\nendmodule\n', ['$ternary$top.sv:3$2', '$ternary$top.sv:2$1']);
  check('two assigns', codes(aa).join() === 'two-assign-drivers' && aa[0].line === 2 && /top\.sv:2 and top\.sv:3/.test(aa[0].text), aa);
  const bb = run('module top(input logic a, b, s, output logic y);\n  always_comb\n    if (s) y = a;\n  always_comb\n    if (!s) y = b;\nendmodule\n', ['$procmux$4', '$procmux$7'], JSON.stringify({ modules: { top: { cells: { '$procmux$4': { attributes: { src: 'top.sv:3.12-3.17' } }, '$procmux$7': { attributes: { src: 'top.sv:5.13-5.18' } } } } } }));
  check('two always blocks', codes(bb).join() === 'two-always-drivers' && /top\.sv:2 and top\.sv:4/.test(bb[0].text), bb);
  const ab = run('module top(input logic a, b, s, output logic y);\n  assign y = s ? a : b;\n  always_comb\n    y = a & b;\nendmodule\n', ['$ternary$top.sv:2$1', '$and$top.sv:4$2']);
  check('assign and always', codes(ab).join() === 'always-and-assign', ab);
  const zz = run('module top(input logic a, b, s, output logic o);\n  logic y;\n  assign y = s ? a : 1\'bz;\n  assign y = s ? 1\'bz : b;\n  assign o = y;\nendmodule\n', ['$ternary$top.sv:3$1', '$ternary$top.sv:4$2']);
  check('internal tri bus is a warning', codes(zz).join() === 'tristate-to-logic' && zz[0].kind === 'warning', zz);
  const pin = promoteDrivers(conflict(['$ternary$top.sv:2$1', '$ternary$top.sv:3$2']), JSON.stringify({ modules: { top: { attributes: { top: '00000000000000000000000000000001' }, ports: { y: { direction: 'inout' } }, cells: {} } } }), { 'top.sv': 'module top(input logic a, b, s, inout wire y);\n  assign y = s ? a : 1\'bz;\n  assign y = s ? 1\'bz : b;\nendmodule\n' });
  check('inout pin keeps the raw warning', pin[0] && /multiple conflicting drivers/.test(pin[0].text) && pin.every((d) => d.kind !== 'error'), pin);
  const unknown = promoteDrivers(conflict(['$auto$1', '$auto$2']), '', {});
  check('no source for mux drivers keeps the raw warning', unknown.every((d) => d.kind !== 'error'), unknown);
}

console.log(`passed ${passed}, failed ${failed}`);
process.exit(failed ? 1 : 0);
