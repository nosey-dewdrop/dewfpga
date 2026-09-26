module top(input logic clk, output logic [15:0] led);
  logic [3:0] cnt = 4'd0;
  always @(posedge clk or negedge clk)   // both clock edges
    cnt <= cnt + 4'd1;
  assign led = {12'd0, cnt};
endmodule
