// Shared input for real CLI and browser round trips.
export const nestedProject = [
  { path: 'rtl/top.sv', text: '`include "inc/width.svh"\nmodule chosen(input [`W-1:0] sw, output [`W-1:0] led);\nreg [`W-1:0] rom[0:15];\ninitial $readmemh("data/rom.mem", rom);\nassign led = rom[sw];\nendmodule\n' },
  { path: 'rtl/other.sv', text: 'module other(input a, output b); assign b = ~a; endmodule\n' },
  { path: 'inc/width.svh', text: '`define W 4\r\n' },
  { path: 'data/rom.mem', text: Array.from({ length: 16 }, (_, i) => (i ^ 10).toString(16)).join('\n') + '\n' },
  { path: 'test/bench.sv', text: '`timescale 1ns/1ps\nmodule bench; reg [3:0] sw; wire [3:0] led; chosen dut(sw,led); integer i; initial begin for(i=0;i<16;i=i+1) begin sw=i; #1; if(led !== (sw ^ 4\'ha)) $fatal(1,"wrong ROM at %0d",i); end $display("PASS nested ROM all 16 addresses"); $finish; end endmodule\n' },
  { path: 'constraints/pins.xdc', text: ['V17','V16','W16','W17'].map((pin,i) => `set_property PACKAGE_PIN ${pin} [get_ports {sw[${i}]}]\nset_property IOSTANDARD LVCMOS33 [get_ports {sw[${i}]}]`).concat(['U16','E19','U19','V19'].map((pin,i) => `set_property PACKAGE_PIN ${pin} [get_ports {led[${i}]}]\nset_property IOSTANDARD LVCMOS33 [get_ports {led[${i}]}]`)).join('\n') + '\n' },
  { path: 'constraints/unselected.xdc', text: 'THIS CONSTRAINT MUST NOT BE USED\n' },
];
