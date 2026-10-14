#!/usr/bin/env python3
"""A register no clock edge ever writes, through the product: dewfpga sim (the RTL, started by sim_starts.py) and
dewfpga bit (the netlist, simulated with yosys' xilinx cells_sim.v), both against values computed here in Python from
the product's start contract (#34/#35: a register with a reset starts at its reset value, one without at 0, a declared
start value as declared), independent of yosys and iverilog. Hardware behavior was not measured in this test.
Fuzz seed 214: a submodule's register whose reset port its instance ties to 1'b0 and whose write condition is never
true (if (a != a) q <= a;) was erased by opt_dff before any start was given: the simulation read x (an if on it took
its else branch, led 0) and the netlist put 1'hx on the LED.
Run: python3 test/test-register-starts.py
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'bin/dewfpga'
ENV = dict(os.environ, LC_ALL='C', LC_CTYPE='C', LANG='C')
CELLS = subprocess.run(['yosys-config', '--datdir'], text=True, capture_output=True, check=True).stdout.strip() + '/xilinx/cells_sim.v'

# sw, btnC per step: every value of sw[3:0] the comparison can split on, btnC pressed twice late.
VECTORS = [(0x0000, 0), (0x0005, 0), (0x000f, 0), (0x0003, 0), (0x0009, 0), (0x0008, 0), (0x000a, 1), (0x0001, 0),
           (0x000f, 0), (0x0009, 1), (0x0000, 0), (0x000c, 0)]

# seed 214's shape, reduced (diagnosis min214): the module is the student's, only the instance's reset differs per case.
HOLD = '''module hold (
  input  logic       clk,
  input  logic       rst,
  input  logic [3:0] a,
  output logic [3:0] q
);
  always_ff @(posedge clk or posedge rst)
    if (rst) q <= 4'd0;
    else begin
      if (a != a) q <= a;
    end
endmodule
'''
TOP = '''module top (
  input  logic        clk,
  input  logic [15:0] sw,
  input  logic        btnC, btnU, btnL, btnR, btnD,
  output logic [15:0] led,
  output logic [6:0]  seg,
  output logic [3:0]  an,
  output logic        dp
);
  logic [3:0] q;
  hold u (.clk(clk), .rst(RST), .a(sw[3:0]), .q(q));
  always_comb begin
    if (q <= sw[3:0]) led = 16'd1;
    else led = 16'd0;
  end
  assign seg = '0;
  assign an = 4'hf;
  assign dp = 1'b0;
endmodule
'''
def hold(decl='output logic [3:0] q', reset="4'd0", write='if (a != a) q <= a;'):
    return HOLD.replace('output logic [3:0] q', decl).replace("q <= 4'd0", f'q <= {reset}').replace('if (a != a) q <= a;', write)

# name, hold module, the instance's reset, q's start, q's next value (q, sw, btnC), and what the case shows.
CASES = [
    ('seed214_never_written', HOLD, "1'b0", 0, lambda q, sw, b: q,
     'min214 verbatim: reset tied off, never written; no reset left, so 0'),
    ('reset_to_one_live', hold(reset="4'hf"), 'btnC', 15, lambda q, sw, b: 15 if b else q,
     'control: a live reset to 1 starts at 1 (FDPE), as before'),
    ('declared_nine', hold(decl="output logic [3:0] q = 4'd9"), "1'b0", 9, lambda q, sw, b: q,
     'control: a declared start value stays 9'),
    ('written_register', hold(write='q <= a;'), "1'b0", 0, lambda q, sw, b: sw & 0xf,
     'control: a register written every edge follows sw[3:0]'),
]

LED_PINS = ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14', 'V14', 'V13', 'V3', 'W3', 'U3', 'P3', 'N3', 'P1', 'L1']
SW_PINS = ['V17', 'V16', 'W16', 'W17', 'W15', 'V15', 'W14', 'W13', 'V2', 'T3', 'T2', 'R3', 'W2', 'U1', 'T1', 'R2']
SEG_PINS = ['W7', 'W6', 'U8', 'V8', 'U5', 'V5', 'U7']
AN_PINS = ['U2', 'U4', 'V4', 'W4']

def xdc():
    pin = lambda p, n: f'set_property -dict {{ PACKAGE_PIN {p} IOSTANDARD LVCMOS33 }} [get_ports {{{n}}}]\n'
    return (pin('W5', 'clk') + 'create_clock -add -name sys_clk_pin -period 10.00 -waveform {0 5} [get_ports clk]\n'
            + pin('U18', 'btnC') + pin('T18', 'btnU') + pin('W19', 'btnL') + pin('T17', 'btnR') + pin('U17', 'btnD')
            + ''.join(pin(p, f'sw[{i}]') for i, p in enumerate(SW_PINS))
            + ''.join(pin(p, f'led[{i}]') for i, p in enumerate(LED_PINS))
            + ''.join(pin(p, f'seg[{i}]') for i, p in enumerate(SEG_PINS))
            + ''.join(pin(p, f'an[{i}]') for i, p in enumerate(AN_PINS)) + pin('V7', 'dp'))

def tb():
    steps = ''.join(f'    @(negedge clk); sw = 16\'h{sw:04x}; btnC = 1\'b{btn}; #1 $display("{i} %b", led);\n'
                    for i, (sw, btn) in enumerate(VECTORS))
    return ('module top_tb;\n  logic clk = 1\'b0; logic [15:0] sw = 16\'d0; logic btnC = 1\'b0, btnU = 1\'b0, btnL = 1\'b0, '
            'btnR = 1\'b0, btnD = 1\'b0;\n  logic [15:0] led; logic [6:0] seg; logic [3:0] an; logic dp;\n'
            '  top dut (.clk(clk), .sw(sw), .btnC(btnC), .btnU(btnU), .btnL(btnL), .btnR(btnR), .btnD(btnD), .led(led), '
            '.seg(seg), .an(an), .dp(dp));\n  always #5 clk = ~clk;\n'
            f'  initial begin\n{steps}    $finish;\n  end\nendmodule\n')

def expected(start, step, rst):
    # the first posedge (t=5) sees sw = 0, btnC = 0; btnC is an asynchronous reset, so it acts as soon as it is set
    q, out = step(start, 0, 0), []
    for i, (sw, btn) in enumerate(VECTORS):
        if btn and rst == 'btnC': q = step(q, sw, btn)
        out.append(f'{i} {int(q <= (sw & 0xf)):016b}')
        q = step(q, sw, btn)
    return out

def trace(path): return [l.strip() for l in path.read_text().splitlines() if l[:1].isdigit()]

def run(args, d, timeout=60):
    return subprocess.run(args, cwd=d, env=ENV, text=True, capture_output=True, timeout=timeout)

def one(case, base):
    name, module, rst, start, step, _ = case
    d = base / name; d.mkdir()
    (d / 'top.sv').write_text(module + '\n' + TOP.replace('.rst(RST)', f'.rst({rst})'))
    (d / 'top_tb.sv').write_text(tb()); (d / 'top.xdc').write_text(xdc())
    want, fails = expected(start, step, rst), []
    r = run([str(CLI), 'sim'], d)
    if r.returncode != 0: fails.append(f'dewfpga sim exit {r.returncode}: {r.stdout[-400:]}{r.stderr[-400:]}')
    elif trace(d / 'top_sim.out') != want: fails.append(f'sim {trace(d / "top_sim.out")} expected {want}')
    r = run([str(CLI), 'bit'], d)
    if r.returncode != 0 or not (d / 'top.bit').is_file():
        return name, fails + [f'dewfpga bit exit {r.returncode}: {(r.stdout + r.stderr)[-600:]}']
    r = run(['sh', '-c', f'yosys -q -p "read_json top.json; write_verilog -noattr net.v" && iverilog -g2012 -s top_tb -o net.vvp net.v top_tb.sv {CELLS} && vvp -n net.vvp > net.out'], d)
    if r.returncode != 0: fails.append(f'netlist simulation exit {r.returncode}: {r.stderr[-400:]}')
    else:
        got = trace(d / 'net.out')
        bad = [(w, g) for w, g in zip(want, got) if w != g]
        if bad or len(got) != len(want): fails.append(f'netlist {len(bad)} of {len(want)} steps differ, first: expected {bad[0][0] if bad else want} got {bad[0][1] if bad else got}')
    return name, fails

with tempfile.TemporaryDirectory(prefix='dewfpga-starts-') as temp:
    results = [one(case, Path(temp)) for case in CASES]
failed = 0
for (name, fails), case in zip(results, CASES):
    print(f'{"PASS" if not fails else "FAIL"} {name}: {case[5]}')
    for f in fails: print(f'  {f}')
    failed += bool(fails)
print(f'{len(CASES) - failed} of {len(CASES)} designs: sim, netlist and the Python start values agree')
sys.exit(1 if failed else 0)
