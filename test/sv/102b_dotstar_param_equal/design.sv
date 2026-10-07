module sub #(parameter N = 4) (input logic [N-1:0] sub_in, output logic [N-1:0] sub_out);
  assign sub_out = ~sub_in;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] sub_in, sub_out;
  assign sub_in = sw[7:0];
  sub #(.N(8)) u (.*);
  assign led = {8'b0, sub_out};
endmodule
