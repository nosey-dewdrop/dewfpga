module top(input logic clk, input logic btnC, output logic [15:0] led);
  logic clk_g;
  logic [3:0] cnt;
  BUFG u_bufg (.I(clk), .O(clk_g));
  always_ff @(posedge clk_g)
    if (btnC) cnt <= '0; else cnt <= cnt + 4'd1;
  assign led = {12'd0, cnt};
endmodule
