// parses a Basys3 .xdc and maps design ports to board elements.
import { BASYS3_PINS } from './basys3_pins.js';

const RE = /set_property\s+(?:-dict\s*\{[^}]*PACKAGE_PIN\s+([A-Z][0-9]+)[^}]*\}|PACKAGE_PIN\s+([A-Z][0-9]+))\s+\[\s*get_ports\s+\{?\s*([A-Za-z_][\w]*)(?:\[(\d+)\])?\s*\}?\s*\]/;

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

// ports: [{name, bits, dir:'input'|'output'}] from the netlist
// returns { map: {portName: [{bit, element, index}]}, errors: [], warnings: [] }
export function bindPorts(ports, xdc) {
  const map = {};
  const errors = [];
  const warnings = [];
  const byPort = new Map();
  for (const p of xdc.pins) {
    if (!byPort.has(p.port)) byPort.set(p.port, []);
    byPort.get(p.port).push(p);
  }
  for (const port of ports) {
    const assigned = byPort.get(port.name) || [];
    byPort.delete(port.name);
    const entries = [];
    for (let b = 0; b < port.bits; b++) {
      const want = port.bits === 1 ? [null, 0] : [b];
      const hit = assigned.find((a) => want.includes(a.bit));
      if (!hit) {
        errors.push(`port ${port.bits === 1 ? port.name : `${port.name}[${b}]`} has no PACKAGE_PIN in the xdc`);
        continue;
      }
      const el = BASYS3_PINS[hit.pin];
      if (!el) continue;
      entries.push({ bit: b, element: el[0], index: el[1], pin: hit.pin, dir: port.dir });
      if (port.dir === 'output' && ['sw', 'btnC', 'btnU', 'btnL', 'btnR', 'btnD', 'clk'].includes(el[0]))
        warnings.push(`${port.name} drives ${el[0]}${el[0] === 'sw' ? `[${el[1]}]` : ''}, which is an input-only thing on the board`);
      if (port.dir === 'input' && ['led', 'seg', 'an', 'dp'].includes(el[0]))
        warnings.push(`${port.name} reads from ${el[0]}[${el[1]}], which is an output-only thing on the board`);
    }
    map[port.name] = entries;
  }
  for (const [name] of byPort) warnings.push(`xdc names a port "${name}" that the design does not have`);
  return { map, errors, warnings };
}

export const MASTER_XDC_HINT = {
  clk: 'set_property -dict { PACKAGE_PIN W5 IOSTANDARD LVCMOS33 } [get_ports clk]',
};
