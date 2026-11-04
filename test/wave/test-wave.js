// The waveform viewer's parser and value formatting, on a dump written the way iverilog writes one, and the first
// view both viewers open with: the browser page's (wave.js startVars) and Surfer's (surfer_wave.py, its commands)
// (templates/wave/; node test/wave/test-wave.js, exit 1 on the first wrong value).
'use strict';
const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
require(path.join(__dirname, '..', '..', 'templates', 'wave', 'wave.js'));
const W = globalThis.DewWave;

// *-*-*-*-*-*-*-*-*-*-*-* a dump as iverilog writes it *-*-*-*-*-*-*-*-*-*-*-*
const vcd = [
  '$date', '\tWed Nov  4 10:37:55 2026', '$end', '$version', '\tIcarus Verilog', '$end',
  '$timescale', '\t1ps', '$end',
  '$scope module tb_mux8 $end',
  '$var wire 1 ! y $end',
  '$var reg 8 " d [7:0] $end',
  '$var reg 3 # s [2:0] $end',
  '$var integer 32 $ errors [31:0] $end',
  '$scope module dut $end',
  '$var wire 8 % d [7:0] $end',
  '$var wire 1 ! y $end',
  '$upscope $end',
  '$scope begin $ivl_for_loop2 $end',
  '$var integer 32 & i [31:0] $end',
  '$upscope $end',
  '$upscope $end',
  '$enddefinitions $end',
  '#0', '$dumpvars', 'x!', 'b0 "', 'b0 #', 'b0 $', 'bx %', 'b0 &', '$end',
  '#1000', '0!', 'b1 "', 'b101 %',
  '#2000', '1!', 'b10 "', 'bz %', 'b11111111111111111111111111111111 $',
  '#2000', '1!',
  '#3000', 'b11111111 "',
  '$comment Dump file limit (64 bytes) exceeded. $end',
  '#5000',
].join('\n') + '\n';

// *-*-*-*-*-*-*-*-*-*-*-* parse *-*-*-*-*-*-*-*-*-*-*-*
const d = W.parseVcd(vcd);
assert.strictEqual(d.tick, 1e-12, 'timescale 1ps');
assert.strictEqual(d.end, 5000, 'last time');
assert.strictEqual(d.truncated, true, 'the dump limit comment is seen');
assert.strictEqual(d.vars.length, 7, 'every $var, aliases included');
const top = d.top.children[0];
assert.strictEqual(top.name, 'tb_mux8');
assert.deepStrictEqual(top.vars.map((v) => v.name + v.range), ['y', 'd[7:0]', 's[2:0]', 'errors[31:0]']);
assert.deepStrictEqual(top.children.map((c) => c.name), ['dut', '$ivl_for_loop2']);
const dutY = top.children[0].vars.find((v) => v.name === 'y');
assert.strictEqual(dutY.code, '!', 'dut.y is the same net as y');
assert.strictEqual(dutY.path, 'tb_mux8.dut.y');

const y = d.sigs.get('!');
assert.deepStrictEqual(y.t, [0, 1000, 2000], 'a repeated value at the same time is one change');
assert.deepStrictEqual(y.v, ['x', '0', '1']);
const dd = d.sigs.get('"');
assert.deepStrictEqual(dd.v, ['00000000', '00000001', '00000010', '11111111'], 'vectors are left-extended with 0');
const dut = d.sigs.get('%');
assert.deepStrictEqual(dut.v, ['xxxxxxxx', '00000101', 'zzzzzzzz'], 'x and z extend with themselves');

// *-*-*-*-*-*-*-*-*-*-*-* values in every radix *-*-*-*-*-*-*-*-*-*-*-*
assert.strictEqual(W.format('00000101', 8, 'hex'), '05');
assert.strictEqual(W.format('00000101', 8, 'bin'), '00000101');
assert.strictEqual(W.format('00000101', 8, 'oct'), '005');
assert.strictEqual(W.format('11111111', 8, 'udec'), '255');
assert.strictEqual(W.format('11111111', 8, 'sdec'), '-1');
assert.strictEqual(W.format('10000000', 8, 'sdec'), '-128');
assert.strictEqual(W.format('01000001', 8, 'ascii'), 'A');
assert.strictEqual(W.format('xxxxxxxx', 8, 'hex'), 'XX');
assert.strictEqual(W.format('0000xxxx', 8, 'hex'), '0X');
assert.strictEqual(W.format('zzzzzzzz', 8, 'hex'), 'ZZ');
assert.strictEqual(W.format('0x01', 4, 'udec'), 'X');
assert.strictEqual(W.format('x', 1, 'hex'), 'X');
assert.strictEqual(W.format('1', 1, 'hex'), '1');
assert.strictEqual(W.format('11111111111111111111111111111111', 32, 'sdec'), '-1', 'an integer is signed decimal');
assert.strictEqual(W.format('101', 3, 'hex'), '5');

// *-*-*-*-*-*-*-*-*-*-*-* a dump with no definitions is still a dump *-*-*-*-*-*-*-*-*-*-*-*
const empty = W.parseVcd('$timescale 1ns $end\n$enddefinitions $end\n#10\n');
assert.strictEqual(empty.vars.length, 0);
assert.strictEqual(empty.end, 10);
assert.strictEqual(empty.tick, 1e-9);

// *-*-*-*-*-*-*-*-*-*-*-* the first view: the testbench's own signals, not its checking *-*-*-*-*-*-*-*-*-*-*-*
// a lab testbench as iverilog dumps it: its stimulus and response, an errors counter, expected values, a parameter,
// a for loop's int (in iverilog's $ivl_for_loop scope), the design under it, which has an `error` output of its own
const lab = [
  '$timescale', '\t1ps', '$end',
  '$scope module tb_room $end',
  '$var parameter 32 ! N $end',
  '$var reg 8 " sensor [7:0] $end',
  '$var wire 1 # alarm $end',
  '$var integer 32 $ errors [31:0] $end',
  '$var integer 32 % error_count [31:0] $end',
  '$var integer 32 & checks [31:0] $end',
  '$var reg 1 \' exp_alarm $end',
  '$var reg 1 ( expected $end',
  '$var reg 1 ) expectedAlarm $end',
  '$var reg 1 * Errors $end',
  '$var reg 1 + errorsx $end',
  '$scope module dut $end',
  '$var wire 8 " sensor [7:0] $end',
  '$var wire 1 # alarm $end',
  '$var wire 1 , error $end',
  '$scope module u_cmp $end',
  '$var wire 1 - gt $end',
  '$upscope $end',
  '$upscope $end',
  '$scope task check $end',
  '$var reg 1 . ok $end',
  '$upscope $end',
  '$scope begin $ivl_for_loop0 $end',
  '$var integer 32 / i [31:0] $end',
  '$upscope $end',
  '$upscope $end',
  '$enddefinitions $end',
  '#0', '$dumpvars', 'b0 "', '0#', '$end',
  ...Array.from({ length: 2047 }, (_, k) => ['#' + (k + 1) * 1000, 'b' + ((k + 1) & 255).toString(2) + ' "']).flat(),
].join('\n') + '\n';
const ld = W.parseVcd(lab);
const start = W.startVars(ld);
assert.strictEqual(start.scope.path, 'tb_room', 'the first view is the testbench');
assert.deepStrictEqual(start.vars.map((v) => v.name), ['sensor', 'alarm', 'errorsx'],
  'its own signals; no parameter, no errors/error_count/checks/exp_/expected counter or value, no loop variable');
const room = ld.top.children[0];
const byName = (sc, n) => sc.vars.find((v) => v.name === n);
assert.strictEqual(W.testOnly(byName(room, 'Errors')), true, 'the rule ignores case');
assert.strictEqual(W.testOnly(byName(room, 'errorsx')), false, 'a longer name is a signal');
assert.strictEqual(W.testOnly(byName(room.children[0], 'error')), false, 'a design signal named error stays: the rule is the testbench\'s');
assert.strictEqual(W.testOnly(byName(room.children[0], 'alarm')), false);

// Surfer's first view from the same dump: the same signals (surfer_wave.py reads wave.js's rule), the design as a
// folded group per instance under the testbench (not the task, not the loop), then the zoom to the first steps
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dewfpga-test-wave-'));
try {
  const file = path.join(dir, 'tb_room.vcd');
  fs.writeFileSync(file, lab);
  const py = 'import sys; sys.path.insert(0, sys.argv[1]); import surfer_wave; print(surfer_wave.commands(sys.argv[2]), end="")';
  const cmds = execFileSync('python3', ['-c', py, path.join(__dirname, '..', '..', 'templates', 'wave'), file], { encoding: 'utf8' }).split('\n');
  const added = cmds.filter((c) => c.startsWith('variable_add ')).map((c) => c.slice('variable_add '.length));
  assert.deepStrictEqual(added, start.vars.map((v) => v.path), 'Surfer starts with the signals the page starts with');
  assert.deepStrictEqual(cmds.filter((c) => c.startsWith('scope_add_as_group_recursive ')), ['scope_add_as_group_recursive tb_room.dut']);
  assert.deepStrictEqual(cmds.slice(added.length + 1, added.length + 3), ['group_fold_all', 'zoom_fit']);
  // 2048 steps of 1 ns: the first 32 end at 31 ns, the run at 2047 ns, 2^6 of them; six zoom_in show the first 32
  assert.strictEqual(cmds.filter((c) => c === 'zoom_in').length, 6, 'zoomed in to the first steps');
  assert.strictEqual(cmds[cmds.length - 2], 'scroll_to_start');
  // a dump with no declarations is refused, not opened empty
  fs.writeFileSync(file, '$timescale 1ns $end\n#10\n');
  assert.throws(() => execFileSync('python3', ['-c', py, path.join(__dirname, '..', '..', 'templates', 'wave'), file], { stdio: 'pipe' }));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('wave viewer: parse, format and the first view ok (' + d.vars.length + ' variables, ' + [...d.sigs.values()].reduce((n, s) => n + s.t.length, 0) + ' changes)');
