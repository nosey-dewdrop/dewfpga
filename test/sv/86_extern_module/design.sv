extern module inv4(input logic [3:0] a, output logic [3:0] y);   // the ports, declared ahead of the body
module inv4(input logic [3:0] a, output logic [3:0] y);
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  inv4 u_inv (.a(sw[3:0]), .y(led[3:0]));
  assign led[15:4] = sw[15:4];
endmodule
