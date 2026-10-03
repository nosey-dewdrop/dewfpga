module top(input logic clk, input logic btnU, input logic btnC, output logic [15:0] led);
  logic [3:0] cnt = 4'd0;
  logic btnU_q = 1'b0;
  always_ff @(posedge clk) btnU_q <= btnU;
  always_ff @(posedge clk)
    if (btnC)                 cnt <= 4'd0;
    else if (btnU && !btnU_q) cnt <= cnt + 4'd1;
  assign led = {12'd0, cnt};
endmodule
