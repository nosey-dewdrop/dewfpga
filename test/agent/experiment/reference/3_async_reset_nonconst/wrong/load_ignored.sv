module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q = 4'd0;
  always_ff @(posedge clk)
    if (btnC) q <= 4'd0;
    else      q <= q + 4'd1;
  assign led = {12'd0, q};
endmodule
