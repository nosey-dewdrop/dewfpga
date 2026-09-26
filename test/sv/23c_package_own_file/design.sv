module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[3:0]  = cfg_pkg::MAGIC ^ sw[3:0];     // cfg_pkg lives in pkg.sv
  assign led[7:4]  = sw[7:4] << cfg_pkg::SHIFT;
  assign led[15:8] = '0;
endmodule
