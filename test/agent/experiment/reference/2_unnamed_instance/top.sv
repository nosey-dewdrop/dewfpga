module inv(input logic a, output logic y);
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  inv u0(sw[0], led[0]);
  assign led[15:1] = sw[15:1];
endmodule
