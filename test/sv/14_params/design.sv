module adder #(parameter int W = 4, parameter logic [W-1:0] K = '0)
             (input logic [W-1:0] a, output logic [W-1:0] y);
  localparam int W2 = W * 2;
  logic [W2-1:0] wide;
  assign wide = a + K;
  assign y = wide[W-1:0];
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  localparam logic [3:0] C = 4'd9;
  adder #(.W(8), .K(8'd3)) u0 (.a(sw[7:0]),  .y(led[7:0]));
  adder #(4)               u1 (.a(sw[11:8]), .y(led[11:8]));
  assign led[15:12] = C;
endmodule
