package hdr_pkg;
  localparam logic [3:0] MAGIC = 4'hA;
endpackage
module top import hdr_pkg::*; (input logic [15:0] sw, output logic [15:0] led);   // import in the module header
  assign led = {12'd0, MAGIC ^ sw[3:0]};
endmodule
