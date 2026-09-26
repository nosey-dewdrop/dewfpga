module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[0] = stop;          // used here, declared on the next line
  logic stop;
  assign stop = sw[0] & sw[1];
  assign led[15:1] = sw[15:1];
endmodule
