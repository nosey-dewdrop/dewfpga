#!/usr/bin/env python3
"""sim and bit read the two Vivado-accepted lines yosys refuses (a port that inherits its direction, an instance
with no name) from a normalized copy: the student's files stay byte for byte as written, on success and on failure,
diagnostics name the student's file:line, and the next run reads the files as they are then."""
from pathlib import Path
import hashlib
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CLI = str(ROOT / 'bin/dewfpga')
ENV = dict(os.environ, LC_ALL='C', LC_CTYPE='C', LANG='C')

TOP = '''module top(input logic [1:0] sw, output logic a, logic b, logic [1:0] c);
  inv(sw[0], a);
  buf2(sw[1], b);
  logic [1:0] rom [0:1];
  initial $readmemh("init.mem", rom);
  `include "consts.svh"
  assign c = rom[sw[0]] ^ K;
endmodule
'''
FILES = {
    'top.sv': TOP,
    'inv.v': 'module inv(input a, output y);\n  assign y = ~a;\nendmodule\n',
    'buf2.v': 'module buf2(input a, output y);\n  wire z;\n  inv(a, z);\n  inv(z, y);\nendmodule\n',
    'consts.svh': "localparam logic [1:0] K = 2'b00;\n",
    'init.mem': '1\n2\n',
    'top_tb.sv': '''module top_tb;
  logic [1:0] sw; logic a, b; logic [1:0] c;
  top dut(.sw(sw), .a(a), .b(b), .c(c));
  initial begin
    sw = 2'b00; #1; if (a !== 1 || b !== 0 || c !== 2'd1) $fatal(1, "bad 00");
    sw = 2'b11; #1; if (a !== 0 || b !== 1 || c !== 2'd2) $fatal(1, "bad 11");
    $display("PASS preserved"); $finish;
  end
endmodule
''',
    'top.xdc': ''.join('set_property -dict { PACKAGE_PIN %s IOSTANDARD LVCMOS33 } [get_ports {%s}]\n' % pp for pp in
                       [('V17', 'sw[0]'), ('V16', 'sw[1]'), ('U16', 'a'), ('E19', 'b'), ('U19', 'c[0]'), ('V19', 'c[1]')]),
}

def run(cwd, *cmd):
    r = subprocess.run(list(cmd), cwd=cwd, env=ENV, capture_output=True, text=True, timeout=90)
    return r.returncode, r.stdout + r.stderr

def hashes(p):
    return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(p.iterdir()) if f.suffix in ('.sv', '.v', '.svh', '.mem', '.xdc')}

def clean(p, out):
    left = [f.name for f in p.iterdir() if f.name.startswith('.dewfpga-kw')]
    assert not left, f'work folder left behind: {left}\n{out}'
    assert '.dewfpga-kw' not in out, out

with tempfile.TemporaryDirectory(prefix='dewfpga-preserve-') as tmp:
    p = Path(tmp) / 'proj'; p.mkdir()
    for n, t in FILES.items(): (p / n).write_text(t)
    before = hashes(p)

    # success: sim, then bit, through the CLI; the notes name the student's lines, the files stay
    rc, out = run(p, CLI, 'sim')
    assert rc == 0 and 'PASS preserved' in out, out
    assert 'top.sv:1: note [port-neither-input-nor-output]' in out and 'top.sv:2: note [unnamed-instance]' in out, out
    assert 'buf2.v:3: note [unnamed-instance]' in out and 'your file stays as you wrote it' in out, out
    assert out.count('top.sv:2: note [unnamed-instance]') == 1, out
    assert hashes(p) == before, 'sim changed a source file'; clean(p, out)
    rc, out = run(p, CLI, 'bit')
    assert rc == 0 and (p / 'top.bit').stat().st_size > 0, out
    assert 'top.sv:1: note [port-neither-input-nor-output]' in out, out
    assert hashes(p) == before, 'bit changed a source file'; clean(p, out)

    # the template Makefile run directly takes the same path
    (p / 'top_sim').unlink()
    rc, out = run(p, 'make', '-s', '-f', str(ROOT / 'templates/Makefile'), 'TOP=top', 'SRCS=top.sv inv.v buf2.v',
                  'TB=top_tb.sv', 'XDC=top.xdc', 'top_sim')
    assert rc == 0 and 'iverilog -g2012' in out and (p / 'top_sim').is_file(), out
    assert hashes(p) == before, 'make changed a source file'; clean(p, out)

    # the next run reads the files as they are now: a changed design, a changed header, each changes the result
    (p / 'top.sv').write_text(TOP.replace('  inv(sw[0], a);', '  buf2(sw[0], a);'))
    rc, out = run(p, CLI, 'sim')
    assert rc != 0 and 'bad 00' in out, out
    (p / 'top.sv').write_text(TOP)
    (p / 'consts.svh').write_text("localparam logic [1:0] K = 2'b11;\n")
    rc, out = run(p, CLI, 'sim')
    assert rc != 0 and 'bad 00' in out, out
    (p / 'consts.svh').write_text(FILES['consts.svh'])
    rc, out = run(p, CLI, 'sim')
    assert rc == 0 and 'PASS preserved' in out, out
    assert hashes(p) == before; clean(p, out)

    # failure: an error after the normalized lines names the student's file and line, and nothing is written
    (p / 'top.sv').write_text(TOP.replace('  assign c = rom[sw[0]] ^ K;', '  assign c = rom[sw[0]] ^ ;'))
    broken = hashes(p)
    rc, out = run(p, CLI, 'sim')
    assert rc != 0 and 'top.sv:7:' in out, out
    assert hashes(p) == broken, 'a failing sim changed a source file'; clean(p, out)
    rc, out = run(p, CLI, 'bit')
    assert rc != 0 and 'top.sv:7' in out, out
    assert hashes(p) == broken, 'a failing bit changed a source file'; clean(p, out)

    # --fix-ports stays the explicit helper that writes the file
    rc, out = run(p, 'python3', str(ROOT / 'templates/check_xdc.py'), '--fix-ports', 'top.sv', 'inv.v', 'buf2.v')
    assert rc == 0 and 'output logic b' in (p / 'top.sv').read_text() and ' inv u_inv(' in (p / 'top.sv').read_text(), out

    # the blink template: no note, nothing written, sim and bit as before
    b = Path(tmp) / 'blink'; b.mkdir()
    for n in ('blink.sv', 'blink_tb.sv', 'blink.xdc'): (b / n).write_bytes((ROOT / 'templates' / n).read_bytes())
    bb = hashes(b)
    rc, out = run(b, CLI, 'sim')
    assert rc == 0 and 'note [unnamed-instance]' not in out and 'note [port-neither' not in out, out
    rc, out = run(b, CLI, 'bit')
    assert rc == 0 and (b / 'blink.bit').stat().st_size > 0 and 'note [port-neither' not in out, out
    assert hashes(b) == bb; clean(b, out)
print('PASS: inherited direction + unnamed instances (.sv and .v) sim and bit from copies, sources byte-identical on success and failure, edits and headers change the next run, blink unaffected')
