module top(input logic [15:0] sw,   // switches; sw[7] is the dot
           output [6:0] seg,         // cathodes, active low
           logic dp,
           output [3:0] an);
  assign seg = ~sw[6:0];
  assign dp = sw[7];
  assign an = ~sw[11:8];
endmodule
