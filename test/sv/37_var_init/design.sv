module top(input logic clk, output logic [15:0] led);
  logic [3:0] cnt = 4'd5;       // declaration initializer = power-up value
  logic [3:0] c2;
  initial c2 = 4'd9;             // initial block = power-up value
  always_ff @(posedge clk) begin
    cnt <= cnt + 4'd1;
    c2  <= c2 - 4'd1;
  end
  assign led = {8'd0, c2, cnt};
endmodule
