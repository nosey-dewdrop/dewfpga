module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q;
  counter u_c (.clk(clk), .rst(btnC), .q(q));   // the submodule lives in counter.sv
  assign led = {sw[15:4], sw[3:0] ^ q};
endmodule
