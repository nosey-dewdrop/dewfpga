#!/usr/bin/env python3
"""Single-file user journey: real synthesis/P&R, independent netlist truth tables, no USB."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('run_file', ROOT / 'templates/run_file.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
ENV = dict(os.environ, LC_ALL='C', LC_CTYPE='C', LANG='C')
CLI = os.environ.get('DEWFPGA_TEST_CLI', str(ROOT / 'bin/dewfpga'))

class Pins(unittest.TestCase):
    def port(self, name, width, offset=0, direction='output', single=False):
        return {'ports': {name: {'bits': list(range(width)), 'offset': offset, 'direction': direction}},
                'netnames': {name: {'attributes': {'single_bit_vector': int(single)}}}}

    def test_ranges_and_scalar(self):
        xdc = runner.auto_xdc(self.port('led', 2, 2))
        self.assertIn('PACKAGE_PIN U19', xdc)
        self.assertIn('{led[2]}', xdc)
        self.assertIn('{led[3]}', xdc)
        self.assertNotIn('{led[0]}', xdc)
        self.assertIn('{led[0]}', runner.auto_xdc(self.port('led', 1, single=True)))
        self.assertIn('[get_ports {led}]', runner.auto_xdc(self.port('led', 1)))
        self.assertIn('create_clock -period 10.000', runner.auto_xdc(self.port('clk', 1, direction='input')))

    def test_reject_unknown_direction_and_range(self):
        for mod in [self.port('mystery', 1), self.port('sw', 1), self.port('led', 17), self.port('led', 2, -1)]:
            with self.assertRaises(ValueError): runner.auto_xdc(mod)

class Journey(unittest.TestCase):
    def test_clock_reset_and_ascending_pins(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-clock-test-') as temp:
            source = Path(temp) / 'anything.sv'
            source.write_text('''module personal_counter(input clk, input btnC, input [0:3] sw, output [0:3] led);
reg [3:0] count = 0;
always @(posedge clk) if (btnC) count <= 0; else count <= count + 1;
assign led = count ^ sw;
endmodule
''')
            cache = Path.home()/'.cache/dewfpga/run'/hashlib.sha256(str(source.resolve()).encode()).hexdigest()[:24]
            r = subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=120)
            self.assertEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertIn('PACKAGE_PIN W5', (cache/'design.xdc').read_text())
            self.assertIn('create_clock -period 10.000', (cache/'design.xdc').read_text())
            subprocess.run(['yosys','-Q','-q','-p',f'read_json {cache}/design.json; write_verilog -noattr net.v'],cwd=temp,env=ENV,check=True)
            (Path(temp)/'tb.v').write_text('''module tb;
reg clk=0, btnC=1; reg [0:3] sw=0; wire [0:3] led; integer i;
personal_counter dut(clk,btnC,sw,led);
initial begin
#1; clk=1; #1; clk=0; #1; if(led!==0) $fatal(1,"reset"); btnC=0;
for(i=1;i<=20;i=i+1) begin clk=1; #1; clk=0; #1; if(led!==(i & 15)) $fatal(1,"count"); end
sw=4'b1010; #1; if(led!==4'b1110) $fatal(1,"switch xor");
btnC=1; clk=1; #1; if(led!==4'b1010) $fatal(1,"reset keeps combinational input");
$display("PASS sequential"); $finish; end endmodule
''')
            data = subprocess.check_output(['yosys-config','--datdir'],env=ENV,text=True).strip()
            subprocess.run(['iverilog','-g2012','-s','tb','-o','sim','tb.v','net.v',str(Path(data)/'xilinx/cells_sim.v')],cwd=temp,env=ENV,check=True)
            r=subprocess.run(['vvp','sim'],cwd=temp,env=ENV,capture_output=True,text=True)
            self.assertEqual(r.returncode,0,r.stdout+r.stderr)
            self.assertIn('PASS sequential',r.stdout)

    def test_real_saved_file(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-single-test-') as temp:
            folder = Path(temp) / 'user files'; folder.mkdir()
            source = folder / "my 'design $(no command).sv"
            (folder / 'unrelated.sv').write_text('this is deliberately not valid verilog;')
            cache = Path.home()/'.cache/dewfpga/run'/hashlib.sha256(str(source.resolve()).encode()).hexdigest()[:24]
            def run(*args, good=True):
                result = subprocess.run([CLI, 'run', str(source), *args], env=ENV, capture_output=True, text=True, timeout=120)
                output = result.stdout + result.stderr
                self.assertEqual(result.returncode == 0, good, output)
                return output
            def truth(invert):
                subprocess.run(['yosys', '-Q', '-q', '-p', f'read_json {cache}/design.json; write_verilog -noattr net.v'], cwd=temp, env=ENV, check=True)
                tb = Path(temp)/'tb.v'
                expected = '(~i & 15)' if invert else 'i'
                tb.write_text('module tb; reg [3:0] sw; wire [3:0] led; integer i;\n'
                              'strange_name dut(sw, led); initial begin\n'
                              f'for(i=0;i<16;i=i+1) begin sw=i; #1; if(led !== {expected}) $fatal(1,"wrong circuit"); end\n'
                              '$display("PASS truth"); $finish; end endmodule\n')
                data = subprocess.check_output(['yosys-config', '--datdir'], env=ENV, text=True).strip()
                subprocess.run(['iverilog','-g2012','-s','tb','-o','sim',str(tb),'net.v',str(Path(data)/'xilinx/cells_sim.v')],cwd=temp,env=ENV,check=True)
                r=subprocess.run(['vvp','sim'],cwd=temp,env=ENV,capture_output=True,text=True)
                self.assertEqual(r.returncode,0,r.stdout+r.stderr)
                self.assertIn('PASS truth',r.stdout)
            original = 'module strange_name #(parameter N=4)(input wire [N-1:0] sw, output wire [N-1:0] led); assign led = sw; endmodule\n'
            source.write_text(original)
            before = {p.name:p.read_bytes() for p in folder.iterdir()}
            run('--build-only'); truth(False)
            self.assertEqual(before,{p.name:p.read_bytes() for p in folder.iterdir()})
            old = (cache/'design.bit').read_bytes()
            source.write_text(original.replace('led = sw','led = ~sw'))
            run('--build-only'); truth(True)
            self.assertNotEqual(old,(cache/'design.bit').read_bytes())
            source.write_text('module strange_name(input [3:0] sw, output [3:0] led);\n assign led = ;\nendmodule\n')
            out=run(good=False)
            self.assertIn(str(source)+':2',out)
            self.assertFalse((cache/'design.bit').exists())
            source.write_text('module strange_name(input a, output y); assign y = a; endmodule\n')
            self.assertIn("No default Basys3 pin",run(good=False))
            xdc=source.with_suffix('.xdc')
            xdc.write_text('set_property -dict { PACKAGE_PIN V17 IOSTANDARD LVCMOS33 } [get_ports a]\n'
                           'set_property -dict { PACKAGE_PIN U16 IOSTANDARD LVCMOS33 } [get_ports y]\n')
            run('--build-only')
            self.assertEqual((cache/'design.xdc').read_text(),xdc.read_text())
            self.assertEqual(sorted(p.name for p in folder.iterdir()),sorted([source.name,xdc.name,'unrelated.sv']))

class Scan(unittest.TestCase):
    def run_cli(self, text):
        with tempfile.TemporaryDirectory(prefix='dewfpga-scan-test-') as temp:
            source = Path(temp) / 'lab1_top.sv'
            source.write_text(text)
            return subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=60)

    def test_misspelled_endmodule_is_named_not_two_tops(self):
        r = self.run_cli('module fa(input logic a, output logic s); assign s = a; endmodule\n'
                         'module fs(input logic a, output logic d); assign d = ~a; endmodule\n'
                         'module lab1_top(input logic [1:0] sw, output logic [1:0] led);\n'
                         '  fa u0(.a(sw[0]), .s(led[0])); fs u1(.a(sw[1]), .d(led[1]));\n'
                         'endmodulek\n')
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('lab1_top.sv:5: ERROR [module-without-endmodule]: module lab1_top', r.stderr)
        self.assertIn('line 5 reads endmodulek', r.stderr)
        self.assertNotIn('two-tops', r.stderr)

    def test_missing_endmodule_before_next_module(self):
        r = self.run_cli('module a(input logic x, output logic y);\n  assign y = x;\n\n'
                         'module lab1_top(input logic sw, output logic led);\n  a u(.x(sw), .y(led));\nendmodule\n')
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('lab1_top.sv:1: ERROR [module-without-endmodule]: module a has no endmodule before the next module (line 4)', r.stderr)

    def test_two_tops_fix_names_run(self):
        r = self.run_cli('module a(input logic x, output logic y); assign y = x; endmodule\n'
                         'module b(input logic x, output logic y); assign y = ~x; endmodule\n')
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn('[two-tops]', r.stderr)
        self.assertIn('dewfpga run lab1_top.sv --top a', r.stderr)
        self.assertNotIn('single-file-run', r.stderr)

if __name__ == '__main__': unittest.main(verbosity=2)
