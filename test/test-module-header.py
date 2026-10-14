#!/usr/bin/env python3
"""Package-import semicolons belong to the header, not to the end of its ports."""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='dewfpga-header-') as temp:
    p = Path(temp)
    files = {
        'pkg.sv': 'package one; localparam K=4; endpackage\npackage two; localparam L=2; endpackage\n',
        'leaf.sv': 'module leaf(input a, output b); assign b=a; endmodule\n',
        'top.sv': '''module chosen
  import one::*;
  import two::L;
  #(parameter W=(K+L)) (input logic key, output logic lamp, logic ready);
  leaf(key, lamp);
  assign ready=~key;
endmodule
''',
        'bench.sv': '''module bench import one::*; ();
  logic key; wire lamp, ready;
  chosen dut(key,lamp,ready);
endmodule
''',
    }
    for name, source in files.items(): (p/name).write_text(source)
    def run(*args):
        r = subprocess.run(['python3', str(ROOT/'templates/check_xdc.py'), *args, *files],
                           cwd=p, text=True, capture_output=True, timeout=15)
        assert r.returncode == 0, r.stdout+r.stderr
        return r.stdout
    assert run('--list-tops').strip() == 'chosen\ttop.sv'
    scan = run('--scan', '--cmd', 'sim')
    assert 'TOP=chosen\n' in scan and 'TB=bench.sv\n' in scan, scan
    work=p/'normalized'; work.mkdir()
    notes=run('--normalize', str(work))
    assert 'top.sv:4: note [port-neither-input-nor-output]' in notes, notes
    assert 'top.sv:5: note [unnamed-instance]' in notes, notes
    for name, source in files.items(): assert (p/name).read_text()==source
print('PASS imported module headers: correct design/testbench, normalization and original locations')
