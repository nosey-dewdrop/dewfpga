module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a, b;
  always_comb begin
    a = (b = sw[3:0]) + 4'd1;             // an assignment within an expression: b gets sw[3:0], a gets b + 1
    led = {8'd0, a, b};
  end
endmodule
