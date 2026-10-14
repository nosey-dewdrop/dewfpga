#!/usr/bin/env python3
"""Multiplications through the product: dewfpga sim (the RTL) and dewfpga bit (the netlist, simulated with yosys'
xilinx cells_sim.v), both against values computed here in Python, independent of yosys and iverilog.
Fuzz seed 302: (b*b) + (b*b) was packed into one DSP48E1 that added 0, so the netlist gave b*b; hardware behavior was not measured in this test.
Every multiplying design must still build its product in a DSP48E1. Prints DSP/LUT/FF and timing per design.
Run: python3 test/test-dsp-products.py
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'bin/dewfpga'
ENV = dict(os.environ, LC_ALL='C', LC_CTYPE='C', LANG='C')
CELLS = subprocess.run(['yosys-config', '--datdir'], text=True, capture_output=True, check=True).stdout.strip() + '/xilinx/cells_sim.v'

# sw values, btnC: unsigned edges, seed 302's own inputs (43b2, 4ea3), and a signed byte below zero in each half.
VECTORS = [(0x0000, 1), (0x43b2, 0), (0x4ea3, 0), (0x00ff, 0), (0x0003, 0), (0xffff, 0), (0x05fd, 0), (0xfd05, 0),
           (0xff80, 0), (0x8080, 0), (0x7f7f, 0), (0x8001, 0), (0x1234, 1), (0xa5c3, 0), (0x0102, 0), (0xfefe, 0)]

def u8(x): return x & 0xff
def s8(x): return x - 0x100 if x & 0x80 else x
def lo(sw): return u8(sw)
def hi(sw): return u8(sw >> 8)

# name, the design's body, led per vector (combinational) or (start state, step) for a clocked design.
CASES = [
    ('twice_sum', 'assign led = (sw[7:0] * sw[7:0]) + (sw[7:0] * sw[7:0]);',
     lambda sw: 2 * lo(sw) * lo(sw)),
    ('twice_mul', 'assign led = 2 * (sw[7:0] * sw[7:0]);',
     lambda sw: 2 * lo(sw) * lo(sw)),
    ('product', 'assign led = sw[7:0] * sw[15:8];',
     lambda sw: lo(sw) * hi(sw)),
    ('product_plus', 'assign led = sw[7:0] * sw[15:8] + sw;',
     lambda sw: lo(sw) * hi(sw) + sw),
    ('signed_twice_sum', 'logic signed [7:0] a, b; logic signed [15:0] p;\n'
     '  assign a = sw[7:0]; assign b = sw[15:8]; assign p = (a * b) + (a * b); assign led = p;',
     lambda sw: 2 * s8(lo(sw)) * s8(hi(sw))),
    ('mac', 'logic [15:0] acc = 16\'d0;\n'
     '  always_ff @(posedge clk) if (btnC) acc <= 16\'d0; else acc <= acc + sw[7:0] * sw[15:8];\n  assign led = acc;',
     (0, lambda acc, sw, btn: 0 if btn else acc + lo(sw) * hi(sw))),
]

LED_PINS = ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14', 'V14', 'V13', 'V3', 'W3', 'U3', 'P3', 'N3', 'P1', 'L1']
SW_PINS = ['V17', 'V16', 'W16', 'W17', 'W15', 'V15', 'W14', 'W13', 'V2', 'T3', 'T2', 'R3', 'W2', 'U1', 'T1', 'R2']

def xdc():
    pin = lambda p, n: f'set_property -dict {{ PACKAGE_PIN {p} IOSTANDARD LVCMOS33 }} [get_ports {{{n}}}]\n'
    return (pin('W5', 'clk') + 'create_clock -add -name sys_clk_pin -period 10.00 -waveform {0 5} [get_ports clk]\n'
            + pin('U18', 'btnC') + ''.join(pin(p, f'sw[{i}]') for i, p in enumerate(SW_PINS))
            + ''.join(pin(p, f'led[{i}]') for i, p in enumerate(LED_PINS)))

def tb():
    steps = ''.join(f'    @(negedge clk); sw = 16\'h{sw:04x}; btnC = 1\'b{btn}; #1 $display("{i} %b", led);\n'
                    for i, (sw, btn) in enumerate(VECTORS))
    return ('module top_tb;\n  logic clk = 1\'b0; logic [15:0] sw = 16\'d0; logic btnC = 1\'b0; logic [15:0] led;\n'
            '  top dut (.clk(clk), .sw(sw), .btnC(btnC), .led(led));\n  always #5 clk = ~clk;\n'
            f'  initial begin\n{steps}    $finish;\n  end\nendmodule\n')

def expected(oracle):
    out = []
    if callable(oracle):
        return [f'{i} {oracle(sw) & 0xffff:016b}' for i, (sw, _) in enumerate(VECTORS)]
    # clocked: the first posedge (t=5) sees sw = 0, btnC = 0; step i shows the state, then its vector is clocked in
    state, step = oracle
    state = step(state, 0, 0) & 0xffff
    for i, (sw, btn) in enumerate(VECTORS):
        out.append(f'{i} {state:016b}')
        state = step(state, sw, btn) & 0xffff
    return out

def trace(path): return [l.strip() for l in path.read_text().splitlines() if l[:1].isdigit()]

def run(args, d, timeout=60):
    return subprocess.run(args, cwd=d, env=ENV, text=True, capture_output=True, timeout=timeout)

def one(case, base):
    name, body, oracle = case
    d = base / name; d.mkdir()
    (d / 'top.sv').write_text('module top (input logic clk, input logic [15:0] sw, input logic btnC, output logic [15:0] led);\n'
                              f'  {body}\nendmodule\n')
    (d / 'top_tb.sv').write_text(tb()); (d / 'top.xdc').write_text(xdc())
    want, fails = expected(oracle), []
    r = run([str(CLI), 'sim'], d)
    if r.returncode != 0: fails.append(f'dewfpga sim exit {r.returncode}: {r.stdout[-400:]}{r.stderr[-400:]}')
    elif trace(d / 'top_sim.out') != want: fails.append(f'sim {trace(d / "top_sim.out")} expected {want}')
    r = run([str(CLI), 'bit'], d)
    log = r.stdout + r.stderr
    if r.returncode != 0 or not (d / 'top.bit').is_file():
        return name, '', fails + [f'dewfpga bit exit {r.returncode}: {log[-600:]}']
    cells = [c['type'] for c in json.loads((d / 'top.json').read_text())['modules']['top']['cells'].values()]
    pnr = next((l.strip() for l in log.splitlines() if l.startswith('pnr ok')), 'no pnr line')
    usage = f'{cells.count("DSP48E1")} DSP48E1, {pnr}'
    if 'DSP48E1' not in cells: fails.append(f'no DSP48E1 in the netlist: {usage}')
    r = run(['sh', '-c', f'yosys -q -p "read_json top.json; write_verilog -noattr net.v" && iverilog -g2012 -s top_tb -o net.vvp net.v top_tb.sv {CELLS} && vvp -n net.vvp > net.out'], d)
    if r.returncode != 0: fails.append(f'netlist simulation exit {r.returncode}: {r.stderr[-400:]}')
    else:
        got = trace(d / 'net.out')
        bad = [(w, g) for w, g in zip(want, got) if w != g]
        if bad or len(got) != len(want): fails.append(f'netlist {len(bad)} of {len(want)} steps differ, first: expected {bad[0][0] if bad else want} got {bad[0][1] if bad else got}')
    return name, usage, fails

with tempfile.TemporaryDirectory(prefix='dewfpga-dsp-') as temp:
    results = [one(case, Path(temp)) for case in CASES]
failed = 0
for name, usage, fails in results:
    print(f'{"PASS" if not fails else "FAIL"} {name}: {usage}')
    for f in fails: print(f'  {f}')
    failed += bool(fails)
print(f'{len(CASES) - failed} of {len(CASES)} designs: sim, netlist and the Python values agree, the product in a DSP48E1')
sys.exit(1 if failed else 0)
