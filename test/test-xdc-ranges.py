#!/usr/bin/env python3
"""Real Yosys port metadata -> XDC validation, without place-and-route.
Run: python3 test/test-xdc-ranges.py
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CHECKER = Path(os.environ.get('XDC_CHECKER', ROOT / 'templates/check_xdc.py'))
CASES = [('', ['sw'], ['led']),
         ('[0:0]', ['sw[0]'], ['led[0]']),
         ('[3:3]', ['sw[3]'], ['led[3]']),
         ('[4:1]', [f'sw[{i}]' for i in range(1, 5)], [f'led[{i}]' for i in range(1, 5)]),
         ('[1:4]', [f'sw[{i}]' for i in range(1, 5)], [f'led[{i}]' for i in range(1, 5)]),
         ('[0:-2]', [f'sw[{i}]' for i in range(-2, 1)], [f'led[{i}]' for i in range(-2, 1)]),
         ('[3:0]', [f'sw[{i}]' for i in range(4)], [f'led[{i}]' for i in range(4)])]

def run(args, cwd):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, timeout=15)

checks = 0
with tempfile.TemporaryDirectory(prefix='dewfpga-xdc-ranges-') as temp:
    p = Path(temp)
    for shape, inputs, outputs in CASES:
        (p / 'design.sv').write_text(f'module top(input logic {shape} sw, output logic {shape} led); assign led = ~sw; endmodule\n')
        result = run(['yosys', '-Q', '-q', '-p', 'read_verilog -sv design.sv; hierarchy -top top; write_json top.json'], p)
        assert result.returncode == 0, result.stderr
        pins = ['V17', 'V16', 'W16', 'W17', 'U16', 'E19', 'U19', 'V19']
        names = inputs + outputs
        lines = [f'set_property -dict {{ PACKAGE_PIN {pin} IOSTANDARD LVCMOS33 }} [get_ports {{{name}}}]\n' for pin, name in zip(pins, names)]
        for mode in ['valid', 'missing', 'commented', 'iostandard', 'duplicate']:
            modified = lines.copy()
            if mode == 'missing': modified.pop()
            if mode == 'commented': modified[-1] = '#' + modified[-1]
            if mode == 'iostandard': modified[-1] = modified[-1].replace(' IOSTANDARD LVCMOS33', '')
            if mode == 'duplicate': modified[-1] = modified[-1].replace(pins[len(names)-1], pins[0])
            (p / 'pins.xdc').write_text(''.join(modified))
            result = run([sys.executable, str(CHECKER), 'top.json', 'pins.xdc'], p)
            message = result.stdout + result.stderr
            expected = {'missing': 'port-without-pin', 'commented': 'port-without-pin', 'iostandard': 'no-iostandard-property', 'duplicate': 'pin-used-twice'}
            if mode == 'valid':
                assert result.returncode == 0 and f'xdc ok: {len(names)} ports' in message, (shape, mode, message)
            else:
                assert result.returncode != 0 and f'ERROR [{expected[mode]}]' in message, (shape, mode, message)
                assert outputs[-1] in message, (shape, mode, message)
            checks += 1
print(f'PASS: {checks} XDC checks across {len(CASES)} real Yosys port shapes')
