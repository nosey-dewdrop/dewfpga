import { readFileSync } from 'node:fs';
import { Sim } from '../src/sim/engine.js';
const sim = new Sim(readFileSync(process.argv[2], 'utf8'));
console.log('ports', sim.ports());
const digit = () => { let m = 0; for (let k = 0; k < 7; k++) if (sim.outBit('seg', k) === -1) m |= 1 << k; return m.toString(2).padStart(7, '0'); };
const an = () => [0,1,2,3].map(i => sim.outBit('an', i)).join(',');
for (let i = 0; i < 4; i++) sim.cycle('clk');
console.log('after 4 cycles: an', an(), 'seg', digit(), 'x-check seg0', sim.outBit('seg', 0));
for (let p = 0; p < 3; p++) {
  sim.setBit('btnC', 0, 1); for (let i = 0; i < 4; i++) sim.cycle('clk');
  sim.setBit('btnC', 0, 0); for (let i = 0; i < 4; i++) sim.cycle('clk');
}
for (let i = 0; i < 8; i++) { sim.cycle('clk'); console.log('an', an(), 'seg', digit()); }
