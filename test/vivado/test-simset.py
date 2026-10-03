#!/usr/bin/env python3
"""Simulation-set errors must stop sim without blocking unrelated design commands."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
ENV = dict(os.environ, LC_ALL="C", LC_CTYPE="C", LANG="C", PYTHONDONTWRITEBYTECODE="1")


class SimulationSetIsolation(unittest.TestCase):
    def test_errors_are_scoped_to_simulation(self):
        with tempfile.TemporaryDirectory(prefix="dewfpga-simset-") as tmp:
            for case in ("missing", "variable", "space", "srcs-space"):
                fixture = Path(tmp) / case
                shutil.copytree(ROOT / "test/vivado/fixture", fixture)
                project = fixture / "Working Lab"
                xpr = project / "NEW.xpr"
                xml = xpr.read_text()
                tb = project / "NEW.srcs/sim_1/new/tb.sv"
                if case == "missing":
                    tb.unlink()
                elif case == "variable":
                    xpr.write_text(xml.replace("$PSRCDIR/sim_1/new/tb.sv", "$PCACHEDIR/tb.sv"))
                else:
                    tb.rename(tb.with_name("tb space.sv"))
                    if case == "space":
                        xpr.write_text(xml.replace("/tb.sv", "/tb space.sv"))
                    else:
                        xpr.unlink()
                        source = project / "NEW.srcs/sources_1/new"
                        (source / "counter2_old.sv").unlink()
                        shutil.copy(fixture / "archive/counter2.sv", source / "counter2.sv")
                for command, expected in (("tops", 0), ("bit", 0), ("sim", 1), ("clean", 0)):
                    with self.subTest(case=case, command=command):
                        result = subprocess.run([str(ROOT / "bin/dewfpga"), command], cwd=project,
                                                env=ENV, capture_output=True, text=True, timeout=120)
                        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
                        if command == "sim":
                            code = {"missing": "vivado-file-missing", "variable": "vivado-path-unknown"}.get(case, "file-name-with-space")
                            self.assertIn("ERROR [" + code + "]", result.stderr)
                            if "space" in case:
                                self.assertIn("tb_space.sv", result.stderr)
                        elif command == "tops":
                            self.assertEqual(result.stdout, "topmodule\tNEW.srcs/sources_1/new/topmodule.sv\n")


if __name__ == "__main__":
    unittest.main()
