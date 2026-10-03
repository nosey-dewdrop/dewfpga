module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  // sw[7:0] + sw[15:8], registered once
  logic [8:0] sum = 9'd0;
  always_ff @(posedge clk) sum <= sw[7:0] + sw[15:8];
  assign led = {7'd0, sum};
endmodule
