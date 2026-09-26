module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[0] = (sw[7:0] ==? 8'b1??0_??01);    // wildcard equality: a ? bit on the right matches anything
  assign led[1] = (sw[15:8] !=? 8'b??11_0???);   // wildcard inequality
  assign led[15:2] = '0;
endmodule
