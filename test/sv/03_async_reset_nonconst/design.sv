module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q;
  always_ff @(posedge clk or posedge btnC)
    if (btnC) q <= sw[3:0];    // async 'reset' loads a signal, not a constant
    else      q <= q + 4'd1;
  assign led = {12'd0, q};
endmodule
