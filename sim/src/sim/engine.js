// netlist simulation: yosys json → digitaljs headless circuit, driven by the board.
import { yosys2digitaljs } from 'yosys2digitaljs/core';
import { HeadlessCircuit } from 'digitaljs';
import { Vector3vl } from '3vl';

const SETTLE_CAP = 20000;

export class Sim {
  constructor(yosysJson) {
    const obj = typeof yosysJson === 'string' ? JSON.parse(yosysJson) : yosysJson;
    this.top = Object.entries(obj.modules).find(([, m]) => m.attributes && m.attributes.top)?.[0] || Object.keys(obj.modules)[0];
    const data = yosys2digitaljs(obj, {});
    this.circuit = new HeadlessCircuit(data);
    this.inputs = new Map();
    this.outputs = new Map();
    for (const c of this.circuit.getInputCells()) this.inputs.set(c.get('net'), c);
    for (const c of this.circuit.getOutputCells()) this.outputs.set(c.get('net'), c);
    this.cellCount = Object.keys(data.devices).length;
    this.values = new Map();
    for (const [n, c] of this.inputs) this.values.set(n, new Array(c.get('bits')).fill(0));
    this.cycles = 0;
    this.combLoop = false;
    for (const [n] of this.inputs) this._push(n);
    this.settle();
  }
  ports() {
    const out = [];
    for (const [name, c] of this.inputs) out.push({ name, bits: c.get('bits'), dir: 'input' });
    for (const [name, c] of this.outputs) out.push({ name, bits: c.get('bits'), dir: 'output' });
    return out;
  }
  _push(name) {
    const cell = this.inputs.get(name);
    const bitsArr = this.values.get(name);
    // fromArray takes lsb-first array of -1/0/1
    cell.setInput(Vector3vl.fromArray(bitsArr.map((b) => (b ? 1 : -1))));
  }
  setBit(name, bit, v) {
    const arr = this.values.get(name);
    if (!arr || arr[bit] === v) return false;
    arr[bit] = v;
    this._push(name);
    return true;
  }
  settle() {
    let n = 0;
    const c = this.circuit;
    while (c.hasPendingEvents && n++ < SETTLE_CAP) c.updateGatesNext();
    if (n >= SETTLE_CAP) this.combLoop = true;
  }
  // one full clock period on the given port
  cycle(clkName) {
    // inputs that changed since the last edge must propagate before the edge,
    // otherwise the flip-flops sample the old value (same event tick).
    if (this.circuit.hasPendingEvents) this.settle();
    this.setBit(clkName, 0, 1); this.settle();
    this.setBit(clkName, 0, 0); this.settle();
    this.cycles++;
  }
  outBit(name, bit) {
    const cell = this.outputs.get(name);
    if (!cell) return -1;
    return cell.getOutput().get(bit); // -1 = 0, 0 = x, 1 = 1
  }
  shutdown() { this.circuit.shutdown(); }
}
