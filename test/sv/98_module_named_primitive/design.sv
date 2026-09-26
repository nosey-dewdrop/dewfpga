// a student's own inverter, named INV: the same name as a Xilinx primitive in yosys' cell library
module INV(input logic a, output logic y);
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  INV u0(.a(sw[0]), .y(led[0]));
  assign led[15:1] = sw[15:1];
endmodule
