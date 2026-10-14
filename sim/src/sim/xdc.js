// parses a Basys3 .xdc and maps design ports to board elements.
import { BASYS3_PINS } from './basys3_pins.js';

const RE = /set_property\s+(?:-dict\s*\{[^}]*PACKAGE_PIN\s+([A-Z][0-9]+)[^}]*\}|PACKAGE_PIN\s+([A-Z][0-9]+))\s+\[\s*get_ports\s+\{?\s*([A-Za-z_][\w]*)(?:\[(-?\d+)\])?\s*\}?\s*\]/;

export function parseXdc(text) {
  const pins = [];   // {line, pin, port, bit}
  const errors = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.split('#')[0].trim();
    if (!line) return;
    const m = RE.exec(line);
    if (!m) {
      if (/PACKAGE_PIN/.test(line)) errors.push({ line: i + 1, msg: `could not read this pin line: ${line}` });
      return;
    }
    const pin = m[1] || m[2];
    const port = m[3];
    const bit = m[4] === undefined ? null : Number(m[4]);
    if (!(pin in BASYS3_PINS)) errors.push({ line: i + 1, msg: `${pin} is not a basys3 pin` });
    pins.push({ line: i + 1, pin, port, bit });
  });
  return { pins, errors };
}

// the source index of internal bit b (lsb first): [4:1] has offset 1, [1:4] is upto with offset 1 (bit 0 is [4])
export const srcIndex = (port, b) => (port.offset || 0) + (port.upto ? port.bits - 1 - b : b);

// ports: [{name, bits, dir:'input'|'output', offset?, upto?, singleBitVector?}] from the netlist
// returns { map: {portName: [{bit, src, element, index}]}, errors: [], warnings: [] }
// bit is the netlist bit (setBit/outBit), src the index the source and the xdc use.
// A known vector, including [0:0], uses its source index. The slang reader does not
// always preserve the width-one vector attribute, so unmarked one-bit ports retain
// the existing bare-name / [0] compatibility.
export function bindPorts(ports, xdc) {
  const map = {};
  const errors = [];
  const warnings = [];
  const byPort = new Map();
  const pinOwner = new Map();   // physical pin -> the port bit that has it
  for (const p of xdc.pins) {
    if (!byPort.has(p.port)) byPort.set(p.port, []);
    byPort.get(p.port).push(p);
  }
  for (const port of ports) {
    const assigned = byPort.get(port.name) || [];
    byPort.delete(port.name);
    const entries = [];
    const scalar = port.bits === 1 && !(port.offset || 0) && !port.singleBitVector;
    const used = new Set();
    for (let b = 0; b < port.bits; b++) {
      const src = srcIndex(port, b);
      const want = scalar ? [null, 0] : [src];
      const hits = assigned.filter((a) => want.includes(a.bit));
      const label = scalar ? port.name : `${port.name}[${src}]`;
      if (!hits.length) {
        errors.push(`port ${label} has no PACKAGE_PIN in the xdc`);
        continue;
      }
      for (const h of hits) used.add(h);
      const pins = [...new Set(hits.map((h) => h.pin))];
      if (pins.length > 1) {
        errors.push(`port ${label} has more than one PACKAGE_PIN in the xdc: ${pins.join(', ')} (lines ${hits.map((h) => h.line).join(', ')})`);
        continue;
      }
      const hit = hits[0];
      const el = BASYS3_PINS[hit.pin];
      if (!el) continue;
      const other = pinOwner.get(hit.pin);
      if (other) errors.push(`pin ${hit.pin} is given to both ${other} and ${label} in the xdc`);
      else pinOwner.set(hit.pin, label);
      // name: how the source and the xdc call this bit (a scalar named bare in the xdc keeps its bare name)
      entries.push({ bit: b, src, name: scalar && hit.bit === null ? port.name : `${port.name}[${src}]`, element: el[0], index: el[1], pin: hit.pin, dir: port.dir });
      if (port.dir === 'output' && ['sw', 'btnC', 'btnU', 'btnL', 'btnR', 'btnD', 'clk'].includes(el[0]))
        warnings.push(`${port.name} drives ${el[0]}${el[0] === 'sw' ? `[${el[1]}]` : ''}, which is an input-only thing on the board`);
      if (port.dir === 'input' && ['led', 'seg', 'an', 'dp'].includes(el[0]))
        warnings.push(`${port.name} reads from ${el[0]}[${el[1]}], which is an output-only thing on the board`);
    }
    for (const a of assigned) if (!used.has(a)) warnings.push(`xdc names ${a.bit === null ? port.name : `${port.name}[${a.bit}]`} (line ${a.line}), which the design's ${port.name} does not have`);
    map[port.name] = entries;
  }
  for (const [name] of byPort) warnings.push(`xdc names a port "${name}" that the design does not have`);
  return { map, errors, warnings };
}

export const MASTER_XDC_HINT = {
  clk: 'set_property -dict { PACKAGE_PIN W5 IOSTANDARD LVCMOS33 } [get_ports clk]',
};
