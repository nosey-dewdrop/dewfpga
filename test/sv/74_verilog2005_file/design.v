// a Verilog-2005 file (.v): bit and final are SystemVerilog keywords, ordinary names in Verilog
module top(input [15:0] sw, output [15:0] led);
  wire bit;
  wire [3:0] final;
  assign bit = sw[0] ^ sw[1];
  assign final = sw[7:4] + 4'd1;
  assign led = {11'b0, final, bit};
endmodule
