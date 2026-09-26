module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a, b;
  always_comb begin
    {>>{a, b}} = sw[7:0];              // streaming concatenation as the target: a gets sw[7:4], b gets sw[3:0]
    led = {8'd0, b, a};
  end
endmodule
