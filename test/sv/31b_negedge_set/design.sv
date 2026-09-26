// registers clocked on the falling edge, with no start value: a counter with a synchronous set and a bit with
// an asynchronous preset. Both resets are built from two switches, so the power-up state shows until they are used
module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q;
  logic p;
  wire pre = sw[13] & sw[12];
  always_ff @(negedge clk)
    if (sw[15] & sw[14]) q <= 4'hf;
    else                 q <= q + 4'd1;
  always_ff @(negedge clk, posedge pre)
    if (pre) p <= 1'b1;
    else     p <= sw[0];
  assign led = {11'd0, p, q};
endmodule
