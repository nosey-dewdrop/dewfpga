module adder(input logic [3:0] a, b, output logic [4:0] s);
  assign s = a + b;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a, b;
  logic [4:0] s, s2;
  assign a = sw[3:0];
  assign b = sw[7:4];
  adder u0 (.*);
  adder u1 (.a, .b(sw[11:8]), .s(s2));
  assign led[4:0] = s;
  assign led[9:5] = s2;
  assign led[15:10] = '0;
endmodule
