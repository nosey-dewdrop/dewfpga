#!/usr/bin/env python3
"""Check programmer failure diagnostics without synthesis or USB access."""
from pathlib import Path
import os
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='dewfpga-programming-') as tmp:
    p = Path(tmp)
    (p / 'top.bit').write_bytes(b'existing-bitstream')
    loader = p / 'openFPGALoader'
    env = dict(os.environ, PATH=str(p) + os.pathsep + os.environ['PATH'], LC_ALL='C', LANG='C')
    cases = [
        ('echo "unable to open ftdi device: -3 (device not found)" >&2; exit 1', 'board-not-found'),
        ('echo "unable to open ftdi device: access denied" >&2; exit 1', 'board-not-found'),
        ('echo "JTAG transfer failed" >&2; exit 1', 'openfpgaloader-failed'),
        ('echo "Programming complete"; exit 0', None),
    ]
    for script, code in cases:
        loader.write_text('#!/bin/sh\n' + script + '\n')
        loader.chmod(0o755)
        r = subprocess.run(['make', '-s', '-f', str(ROOT / 'templates/Makefile'),
                            '-o', 'top.bit', 'TOP=top', 'flash'], cwd=p, env=env,
                           capture_output=True, text=True, timeout=10)
        out = r.stdout + r.stderr
        assert (r.returncode == 0) == (code is None), out
        if code:
            assert f'ERROR [{code}]' in out, out
        else:
            assert 'Programming complete' in out and 'ERROR [' not in out, out
        assert 'the Mac sees no Basys3' not in out, out
        if code == 'board-not-found':
            assert 'if macOS lists the Digilent device' in out, out
        assert (p / 'top.bit').read_bytes() == b'existing-bitstream'
        assert not list(p.glob('*.json')) and not list(p.glob('*.fasm'))
print('PASS: four programmer outcomes, correct exit status, no rebuild or USB access')
