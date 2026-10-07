module top(input logic [15:0] sw, output logic [15:0] led);
  logic q;
  always_latch if (sw[1]) q = sw[0];   // a latch on purpose: sw[1] is its gate
  assign led = {15'b0, q};
endmodule
