`include "defs.svh"
`define USE_FEATURE
module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[`WIDTH-1:0] = `MAX(sw[3:0], sw[7:4]);
`ifdef USE_FEATURE
  assign led[4 +: `WIDTH] = 4'hC;
`else
  assign led[7:4] = 4'h3;
`endif
`ifndef NOT_DEFINED
  assign led[15:8] = sw[15:8];
`endif
endmodule
