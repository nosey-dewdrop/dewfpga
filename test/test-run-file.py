#!/usr/bin/env python3
"""Single-file user journey: real synthesis/P&R, independent netlist truth tables, no USB."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
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

class Folder(unittest.TestCase):
    """A lab folder: the file the student runs uses modules (and a package) from the files beside it."""
    def netlist_truth(self, temp, cache):
        subprocess.run(['yosys','-Q','-q','-p',f'read_json {cache}/design.json; write_verilog -noattr net.v'],cwd=temp,env=ENV,check=True)
        (Path(temp)/'tb.v').write_text('module tb; reg [2:0] sw; wire [1:0] led; integer i;\n'
            'top dut(.sw(sw), .led(led)); initial begin\n'
            'for(i=0;i<8;i=i+1) begin sw=i; #1; if(led !== {(i[0]&i[1])|(i[2]&(i[0]^i[1])), i[0]^i[1]^i[2]}) $fatal(1,"wrong adder %0d %b",i,led); end\n'
            '$display("PASS adder"); $finish; end endmodule\n')
        data = subprocess.check_output(['yosys-config','--datdir'],env=ENV,text=True).strip()
        subprocess.run(['iverilog','-g2012','-s','tb','-o','sim','tb.v','net.v',str(Path(data)/'xilinx/cells_sim.v')],cwd=temp,env=ENV,check=True)
        r = subprocess.run(['vvp','sim'],cwd=temp,env=ENV,capture_output=True,text=True)
        self.assertIn('PASS adder', r.stdout, r.stdout + r.stderr)

    def test_sibling_modules_package_and_either_file(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-folder-test-') as temp:
            folder = Path(temp) / 'lab 2'; folder.mkdir()
            (folder/'widths.sv').write_text('package widths; localparam int N = 3; endpackage\n')
            (folder/'full_adder.sv').write_text('module full_adder(input logic a, b, cin, output logic s, cout);\n'
                                                '  assign s = a ^ b ^ cin;\n  assign cout = (a & b) | (cin & (a ^ b));\nendmodule\n')
            (folder/'top.sv').write_text('import widths::*;\nmodule top(input logic [N-1:0] sw, output logic [1:0] led);\n'
                                         '  full_adder fa(.a(sw[0]), .b(sw[1]), .cin(sw[2]), .s(led[0]), .cout(led[1]));\nendmodule\n')
            (folder/'top_tb.sv').write_text('module top_tb; logic [2:0] sw; logic [1:0] led; top dut(.*); initial $finish; endmodule\n')
            (folder/'old_try.sv').write_text('module half(input a output y) assign y = ; endmodul\n')
            before = {p.name: p.read_bytes() for p in folder.iterdir()}
            for clicked in ('top.sv', 'full_adder.sv'):
                source = folder/clicked
                cache = Path.home()/'.cache/dewfpga/run'/hashlib.sha256(str(source.resolve()).encode()).hexdigest()[:24]
                r = subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=180)
                out = r.stdout + r.stderr
                self.assertEqual(r.returncode, 0, out)
                self.assertIn('(top: top' + ('' if clicked == 'top.sv' else ', in top.sv') + ')', out)
                self.assertIn('Also reads: ', out)
                for name in ('old_try.sv', 'top_tb.sv'): self.assertNotIn(name, out)
                self.netlist_truth(temp, cache)
            self.assertEqual(before, {p.name: p.read_bytes() for p in folder.iterdir()})

    def test_a_used_sibling_that_is_broken_is_named(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-folder-test-') as temp:
            folder = Path(temp).resolve(); source = folder/'top.sv'
            (folder/'full_adder.sv').write_text('module full_adder(input logic a, b, cin, output logic s, cout);\n  assign s = a ^ ;\nendmodule\n')
            source.write_text('module top(input logic [2:0] sw, output logic [1:0] led);\n'
                              '  full_adder fa(.a(sw[0]), .b(sw[1]), .cin(sw[2]), .s(led[0]), .cout(led[1]));\nendmodule\n')
            r = subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=120)
            self.assertNotEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn(str(folder/'full_adder.sv') + ':2: ERROR', r.stdout + r.stderr)
            self.assertNotIn('dep1.sv', r.stdout + r.stderr)

class PinsAndProjects(unittest.TestCase):
    """The pin file and the project a lab folder already has: Run reads them as the folder command does."""
    def run_cli(self, source, *args):
        r = subprocess.run([CLI,'run',str(source),'--build-only',*args],env=ENV,capture_output=True,text=True,timeout=240)
        return r.returncode, r.stdout + r.stderr

    def test_the_folder_pin_file_that_names_the_ports(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-pins-test-') as temp:
            folder = Path(temp).resolve(); source = folder/'adder.sv'
            source.write_text('module adder(input logic a, b, output logic y, c);\n  assign y = a ^ b;\n  assign c = a & b;\nendmodule\n')
            pins = ''.join(f'set_property -dict {{ PACKAGE_PIN {p} IOSTANDARD LVCMOS33 }} [get_ports {n}]\n'
                           for n, p in (('a','V17'),('b','V16'),('y','U16'),('c','E19')))
            (folder/'constraints.xdc').write_text('## lab 2 pins\n' + pins)
            rc, out = self.run_cli(source)
            self.assertEqual(rc, 0, out); self.assertIn('Pins: ' + str(folder/'constraints.xdc'), out)
            cache = Path.home()/'.cache/dewfpga/run'/hashlib.sha256(str(source).encode()).hexdigest()[:24]
            self.assertEqual((cache/'design.xdc').read_text(), (folder/'constraints.xdc').read_text())
            # a second .xdc that pins none of these ports (another design's) is not a reason to stop
            (folder/'old_lab.xdc').write_text('set_property -dict { PACKAGE_PIN W5 IOSTANDARD LVCMOS33 } [get_ports clk]\n')
            rc, out = self.run_cli(source)
            self.assertEqual(rc, 0, out); self.assertIn('Pins: ' + str(folder/'constraints.xdc'), out)
            # standard names and only another design's .xdc: the automatic pins, not that file
            source.write_text('module adder(input logic [1:0] sw, output logic [1:0] led);\n  assign led = {&sw, ^sw};\nendmodule\n')
            (folder/'constraints.xdc').unlink()
            rc, out = self.run_cli(source)
            self.assertEqual(rc, 0, out); self.assertIn('Pins: automatic Basys3 mapping', out)

    def test_a_file_of_a_vivado_project_builds_the_project(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-xpr-test-') as temp:
            shutil.copytree(ROOT/'test/vivado/fixture', Path(temp)/'fx')
            root = (Path(temp)/'fx'/'Working Lab').resolve(); new = root/'NEW.srcs'/'sources_1'/'new'
            rc, out = self.run_cli(new/'topmodule.sv')
            self.assertEqual(rc, 0, out)
            self.assertIn('(Vivado project Working Lab: its files, its top, its .xdc)', out)
            self.assertIn('top from the project: topmodule', out)
            self.assertTrue((root/'topmodule.bit').is_file())
            self.assertIn('(full log: ' + str(root/'topmodule.log') + ')', out)
            text = (new/'topmodule.sv').read_text().splitlines()
            line = next(i for i, l in enumerate(text) if 'endmodule' in l)
            (new/'topmodule.sv').write_text('\n'.join(text[:line] + ['  assign = ;'] + text[line:]) + '\n')
            rc, out = self.run_cli(new/'topmodule.sv')
            self.assertNotEqual(rc, 0, out)
            self.assertIn(str(new/'topmodule.sv') + ':' + str(line + 1) + ':', out)

class NetlistPorts(unittest.TestCase):
    """A course ready module in Vivado's netlist form, with an explicit port for its constant output."""
    def test_explicit_constant_port_builds_and_stays_zero(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-netlist-test-') as temp:
            folder = Path(temp).resolve(); source = folder/'top.sv'
            ready = folder/'ready_and.v'
            ready.write_text('(* keep_hierarchy = "yes" *)\nmodule ready_and\n   (a, b,\n    y, .dp(\\<const0> ));\n'
                             '  input a;\n  input b;\n  output y;\n  output \\<const0> ;\n\n  wire \\<const0> ;\n'
                             '  GND GND\n       (.G(\\<const0> ));\n  LUT2 #(\n    .INIT(4\'h8))\n    y_INST_0\n'
                             '       (.I0(a),\n        .I1(b),\n        .O(y));\nendmodule\n')
            source.write_text('module top(input logic [1:0] sw, output logic [0:0] led, output logic dp);\n'
                              '  ready_and u(.a(sw[0]), .b(sw[1]), .y(led[0]), .dp(dp));\nendmodule\n')
            before = ready.read_bytes()
            r = subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=180)
            out = r.stdout + r.stderr
            self.assertEqual(r.returncode, 0, out)
            self.assertIn(str(ready) + ':4: note [explicit-port]: wrote the port as a plain name:', out)
            self.assertIn(str(ready) + ':8: note [explicit-port]: declared the port and connected its net:  output dp; assign dp = \\<const0> ;', out)
            self.assertEqual(ready.read_bytes(), before)
            cache = Path.home()/'.cache/dewfpga/run'/hashlib.sha256(str(source).encode()).hexdigest()[:24]
            subprocess.run(['yosys','-Q','-q','-p',f'read_json {cache}/design.json; setattr -mod -unset keep_hierarchy *; hierarchy -top top; flatten; write_verilog -noattr net.v'],cwd=temp,env=ENV,check=True)
            (Path(temp)/'tb.v').write_text('module tb; reg [1:0] sw; wire [0:0] led; wire dp; integer i;\n'
                'top dut(.sw(sw), .led(led), .dp(dp)); initial begin\n'
                'for(i=0;i<4;i=i+1) begin sw=i; #1; if(led !== (i==3) || dp !== 1\'b0) $fatal(1,"wrong %0d %b %b",i,led,dp); end\n'
                '$display("PASS netlist"); $finish; end endmodule\n')
            data = subprocess.check_output(['yosys-config','--datdir'],env=ENV,text=True).strip()
            subprocess.run(['iverilog','-g2012','-s','tb','-o','sim','tb.v','net.v',str(Path(data)/'xilinx/cells_sim.v')],cwd=temp,env=ENV,check=True)
            v = subprocess.run(['vvp','sim'],cwd=temp,env=ENV,capture_output=True,text=True)
            self.assertIn('PASS netlist', v.stdout, v.stdout + v.stderr)

class NetlistNets(unittest.TestCase):
    """Vivado netlists use implicit nets between cells; a design module may share a cell's name."""
    def build(self, folder, text):
        source = folder/'top.sv'; source.write_text(text)
        r = subprocess.run([CLI,'run',str(source),'--build-only'],env=ENV,capture_output=True,text=True,timeout=180)
        return r.returncode, r.stdout + r.stderr, source

    def test_implicit_net_driven_by_a_cell_output(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-netlist-test-') as temp:
            folder = Path(temp).resolve()
            (folder/'ready_toggle.v').write_text('module ready_toggle(clk, q);\n  input clk;\n  output q;\n'
                '  FDRE #(.INIT(1\'b0)) state_reg (.C(clk), .CE(1\'b1), .D(next_state), .Q(state), .R(1\'b0));\n'
                '  LUT1 #(.INIT(2\'h1)) next_i (.I0(state), .O(next_state));\n  assign q = state;\nendmodule\n')
            rc, out, source = self.build(folder, 'module top(input logic clk, output logic [0:0] led);\n'
                                                 '  ready_toggle u(.clk(clk), .q(led[0]));\nendmodule\n')
            self.assertEqual(rc, 0, out); self.assertNotIn('undeclared-name', out)
            self.assertIn('1 FF', out)

    def test_a_design_module_named_like_a_cell_stays_with_the_first_reader(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-netlist-test-') as temp:
            rc, out, _ = self.build(Path(temp).resolve(), 'module INV(input logic a, output logic y); assign y = ~a; endmodule\n'
                'module top(input logic [0:0] sw, output logic [0:0] led);\n  INV u(.a(sw[0]), .y(led[0]));\nendmodule\n')
            self.assertEqual(rc, 0, out); self.assertNotIn('read-with-slang', out); self.assertIn('1 LUT', out)

class SeveralPinFiles(unittest.TestCase):
    """A folder or a Vivado constraint set with one .xdc per lab part: the one that pins the top's ports."""
    AND = 'module and_gate(input logic a, b, output logic y);\n  assign y = a & b;\nendmodule\n'
    def pins(self, *pairs):
        return ''.join(f'set_property -dict {{ PACKAGE_PIN {p} IOSTANDARD LVCMOS33 }} [get_ports {n}]\n' for n, p in pairs)
    def bit(self, cwd):
        r = subprocess.run([CLI,'bit'],cwd=cwd,env=ENV,capture_output=True,text=True,timeout=240)
        return r.returncode, r.stdout + r.stderr

    def test_flat_folder(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-xdcs-test-') as temp:
            d = Path(temp)
            (d/'and_gate.sv').write_text(self.AND)
            (d/'part_a.xdc').write_text(self.pins(('a','V17'),('b','V16'),('y','U16')))
            (d/'part_b.xdc').write_text(self.pins(('x0','W16'),('z','E19')))
            rc, out = self.bit(d)
            self.assertEqual(rc, 0, out)
            self.assertIn("pins: part_a.xdc (the one .xdc here that pins and_gate's ports)", out)
            self.assertTrue((d/'and_gate.bit').is_file())
            (d/'part_b.xdc').write_text(self.pins(('y','E19')))       # both pin y: which one Vivado keeps is not ours to guess
            rc, out = self.bit(d)
            self.assertNotEqual(rc, 0, out); self.assertIn('ERROR [two-xdc-files]', out)

    def test_vivado_constraint_set(self):
        with tempfile.TemporaryDirectory(prefix='dewfpga-xdcs-test-') as temp:
            root = Path(temp)/'Lab3'; new = root/'Lab3.srcs'/'sources_1'/'new'; cons = root/'Lab3.srcs'/'constrs_1'/'new'
            new.mkdir(parents=True); cons.mkdir(parents=True)
            (new/'and_gate.sv').write_text(self.AND)
            (cons/'cons_decoder.xdc').write_text(self.pins(('a0','W16'),('y0','E19')))
            (cons/'cons_and.xdc').write_text(self.pins(('a','V17'),('b','V16'),('y','U16')))
            rc, out = self.bit(new)
            self.assertEqual(rc, 0, out)
            self.assertIn("pins: Lab3.srcs/constrs_1/new/cons_and.xdc (the one .xdc here that pins and_gate's ports)", out)
            rc, out = subprocess.run([CLI,'run',str(new/'and_gate.sv'),'--build-only'],env=ENV,capture_output=True,text=True,timeout=240).returncode, ''
            self.assertEqual(rc, 0)

if __name__ == '__main__': unittest.main(verbosity=2)
