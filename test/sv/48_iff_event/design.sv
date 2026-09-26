module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] q;
  always_ff @(posedge clk iff sw[15]) q <= sw[7:0];   // the edge counts only while sw[15] is 1
  assign led = {8'b0, q};
endmodule
