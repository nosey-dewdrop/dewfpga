module top(input logic [15:0] sw, output logic [15:0] led);
  logic [1:0] s;
  assign s = {sw[1] ^ sw[0], sw[0] ^ sw[1]};
  always_latch if (s < sw) led = {15'b0, (sw < 16'd1791)};
endmodule
