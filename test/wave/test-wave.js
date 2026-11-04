// The waveform viewer's parser and value formatting, on a dump written the way iverilog writes one
// (templates/wave/wave.js; node test/wave/test-wave.js, exit 1 on the first wrong value).
'use strict';
const path = require('path');
const assert = require('assert');
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

console.log('wave viewer: parse and format ok (' + d.vars.length + ' variables, ' + [...d.sigs.values()].reduce((n, s) => n + s.t.length, 0) + ' changes)');
