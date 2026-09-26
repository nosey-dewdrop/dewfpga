config cfg;                              // a configuration: which library each cell of the design comes from
  design work.top;
  default liblist work;
endconfig
module top(input logic [15:0] sw, output logic [15:0] led);
  assign led = {sw[7:0], sw[15:8]};
endmodule
