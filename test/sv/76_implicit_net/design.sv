module and2(input logic a, b, output logic y);
  assign y = a & b;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  and2 u1 (.a(sw[0]), .b(sw[1]), .y(w));      // w is never declared: an implicit net from a port connection
  assign eq = sw[3:2] == sw[5:4];              // eq is never declared: an implicit net from the left of an assign
  assign led = {14'd0, eq, w};
endmodule
