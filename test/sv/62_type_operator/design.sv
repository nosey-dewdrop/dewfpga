module top(input logic [15:0] sw, output logic [15:0] led);
  logic [5:0] a;
  var type(a) b;                       // the type operator: b has a's type, logic [5:0]
  assign a = sw[5:0];
  assign b = a + 6'd3;                 // wraps at 6 bits, as a does
  assign led = {10'd0, b};
endmodule
