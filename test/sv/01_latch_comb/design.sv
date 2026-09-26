module top(input logic [15:0] sw, output logic [15:0] led);
  logic q;
  always_comb begin
    if (sw[1]) q = sw[0];      // no else: q keeps its value -> latch
  end
  assign led[0] = q;
  assign led[15:1] = '0;
endmodule
