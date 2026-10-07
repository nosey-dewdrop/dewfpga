module top(input logic [15:0] sw, output logic [15:0] led);
  import a_pkg::*;
  assign led[3:0]  = sw[3:0] ^ K;
  assign led[15:4] = '0;
endmodule
