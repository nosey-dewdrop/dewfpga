// node build/smoke.mjs [directory containing the generated .mjs and .wasm files]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../', import.meta.url));
const { default: createIverilog } = await import(pathToFileURL(resolve(dir, 'iverilog.mjs')));
const { default: createVvp } = await import(pathToFileURL(resolve(dir, 'vvp.mjs')));
const output = [];
const options = { print: s => output.push(s), printErr: s => output.push(s) };
const iv = await createIverilog(options);
iv.FS.mkdir('/work');
iv.FS.writeFile('/work/width.svh', '`define WIDTH 4\n');
iv.FS.writeFile('/work/counter.sv', `
\`include "width.svh"
module counter(input logic clk, output logic [\`WIDTH-1:0] q = 0);
  always @(posedge clk) q <= q + 1;
endmodule
`);
iv.FS.writeFile('/work/tb.sv', `
module tb;
  reg clk = 0;
  wire [3:0] q;
  counter dut(clk, q);
  always #5 clk = ~clk;
  initial begin
    $dumpfile("/work/wave.vcd");
    $dumpvars(0, tb);
    #31;
    if (q !== 3) $fatal(1, "wrong count: %d", q);
    if (!$test$plusargs("verify")) $fatal(1, "missing plusarg");
    $display("SMOKE_PASS count=%0d", q);
    $finish;
  end
endmodule
`);
assert.equal(iv.callMain(['-g2012', '-I/work', '-s', 'tb', '-o', '/work/out.vvp', '/work/tb.sv', '/work/counter.sv']), 0, output.join('\n'));
const executable = iv.FS.readFile('/work/out.vvp');
const vv = await createVvp(options);
vv.FS.mkdir('/work');
vv.FS.writeFile('/work/out.vvp', executable);
assert.equal(vv.callMain(['/work/out.vvp', '+verify']), 0, output.join('\n'));
assert.ok(output.some(s => s.includes('SMOKE_PASS count=3')), output.join('\n'));
const vcd = vv.FS.readFile('/work/wave.vcd', { encoding: 'utf8' });
assert.match(vcd, /\$var\s+wire\s+4\s+\S+\s+q/);
assert.match(vcd, /#31\b/);

const invalid = await createIverilog(options);
invalid.FS.writeFile('/broken.sv', 'module broken( SYNTAX ERROR; endmodule');
assert.notEqual(invalid.callMain(['-g2012', '-o', '/broken.vvp', '/broken.sv']), 0, 'invalid source must fail');
// Emscripten propagates callMain's expected rejection to Node's process.exitCode.
process.exitCode = 0;
console.log('PASS: two-file compile, include, counter output, plusargs, VCD, invalid-source rejection');
