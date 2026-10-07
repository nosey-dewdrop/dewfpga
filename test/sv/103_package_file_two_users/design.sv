module top(input logic [15:0] sw, output logic [15:0] led);
  import cfg_pkg::*;
  nib_t hi;
  sub u_sub (.a(sw[3:0]), .y(led[3:0]));
  assign hi = sw[7:4] & MAGIC;
  assign led[7:4]  = hi;
  assign led[15:8] = '0;
endmodule
