module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  // sw[7:0] + sw[15:8], registered once
  logic [8:0] sum;
  always_comb sum = sw[7:0] + sw[15:8];
  assign led = {7'd0, sum};
endmodule
