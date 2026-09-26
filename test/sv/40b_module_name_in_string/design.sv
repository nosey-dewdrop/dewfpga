module counter(input logic clk, input logic rst, output logic [3:0] q);
  always_ff @(posedge clk) if (rst) q <= '0; else q <= q + 4'd1;
endmodule
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q;
  counter u_cnt (.clk(clk), .rst(btnC), .q(q));
  always @(posedge clk) if (q == 4'hf) $display("counter (u_cnt) wrapped");   // a module name and ( in a string
  assign led = {sw[15:4], q};
endmodule
