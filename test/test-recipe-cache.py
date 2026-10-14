#!/usr/bin/env python3
"""An installed recipe update must rebuild an unchanged user's cached design."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENV = dict(os.environ, LC_ALL='C', LC_CTYPE='C', LANG='C')
with tempfile.TemporaryDirectory(prefix='dewfpga-recipe-cache-') as temp:
    base = Path(temp)
    chain = base / 'chain'
    chain.mkdir()
    shutil.copytree(ROOT / 'bin', chain / 'bin')
    shutil.copytree(ROOT / 'templates', chain / 'templates')
    shutil.copy2(ROOT / 'package.json', chain / 'package.json')
    project = base / 'project'
    project.mkdir()
    for name in ['blink.sv', 'blink_tb.sv', 'blink.xdc']:
        shutil.copy2(ROOT / 'templates' / name, project / name)
    def run(command):
        result = subprocess.run([str(chain / 'bin/dewfpga'), command], cwd=project,
                                env=ENV, capture_output=True, text=True, timeout=90)
        output = result.stdout + result.stderr
        assert result.returncode == 0, output
        return output
    assert 'pnr ok' in run('bit')
    assert 'iverilog -g2012' in run('sim')
    assert 'up to date' in run('bit')
    assert 'iverilog -g2012' not in run('sim')
    # Preserve the timestamp deliberately: this tests recipe content, not just mtime.
    recipe = chain / 'templates/Makefile'
    stamp = recipe.stat()
    recipe.write_bytes(recipe.read_bytes() + b'\n# installed recipe update\n')
    os.utime(recipe, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert 'pnr ok' in run('bit'), 'new recipe reused the old bitstream'
    assert 'iverilog -g2012' in run('sim'), 'new recipe reused the old simulation'
    assert 'up to date' in run('bit'), 'unchanged recipe needlessly rebuilt'
    checker = chain / 'templates/check_xdc.py'
    stamp = checker.stat()
    checker.write_bytes(checker.read_bytes() + b'\n# installed checker update\n')
    os.utime(checker, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
    assert 'pnr ok' in run('bit'), 'new checker reused the old bitstream'
print('PASS recipe/checker updates rebuild cached designs; unchanged tools reuse outputs')
