module tristate(input  logic [3:0] a,           // the textbook's tristate buffer
                input  logic       en,
                output tri   [3:0] y);
  assign y = en ? a : 4'bz;
endmodule
module top(input logic [15:0] sw, output tri [15:0] led);   // each nibble of led driven from its own instance
  tristate t0 (.a(sw[3:0]),   .en(sw[15]), .y(led[3:0]));
  tristate t1 (.a(sw[7:4]),   .en(sw[14]), .y(led[7:4]));
  tristate t2 (.a(sw[11:8]),  .en(sw[13]), .y(led[11:8]));
  tristate t3 (.a(sw[15:12]), .en(sw[12]), .y(led[15:12]));
endmodule
