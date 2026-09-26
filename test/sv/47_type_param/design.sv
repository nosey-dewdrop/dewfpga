module inv_t #(parameter type T = logic [3:0]) (input T a, output T y);
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  inv_t #(.T(logic [7:0])) u8 (.a(sw[7:0]), .y(led[7:0]));     // the type overridden: 8 bits
  inv_t                    u4 (.a(sw[11:8]), .y(led[11:8]));   // the default type: 4 bits
  assign led[15:12] = '0;
endmodule
