module inv(input logic a, output logic y);
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  inv u_inv [3:0] (.a(sw[3:0]), .y(led[3:0]));
  assign led[15:4] = sw[15:4];
endmodule
