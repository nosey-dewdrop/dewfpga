module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q, d;
  always_ff @(posedge clk, posedge btnC) begin
    if (btnC) q <= 4'd0;
    else      q <= sw[3:0];
    d <= q;                     // after the if/else: it runs on btnC's rising edge too
  end
  assign led = {8'd0, d, q};
endmodule
