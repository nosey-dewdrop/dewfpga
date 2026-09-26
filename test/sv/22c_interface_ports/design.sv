interface cnt_if(input logic clk, input logic en);   // an interface with ports
  logic [3:0] q = 4'd0;
  always_ff @(posedge clk) if (en) q <= q + 4'd1;
endinterface
module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  cnt_if c (.clk(clk), .en(sw[0]));
  assign led = {12'd0, c.q};
endmodule
