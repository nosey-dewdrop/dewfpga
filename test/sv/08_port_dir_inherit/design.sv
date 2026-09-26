module top(input logic clk, input logic [15:0] sw,
           output [6:0] seg, logic dp,     // course SevenSegmentDisplay.sv port line: dp inherits 'output'
           output [3:0] an);
  assign seg = ~sw[6:0];
  assign dp = sw[7];
  assign an = ~sw[11:8];
endmodule
