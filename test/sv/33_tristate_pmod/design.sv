module top(input logic [15:0] sw, output logic [15:0] led, inout wire [7:0] JA);
  assign JA[0] = sw[0] ? sw[1] : 1'bz;   // drive the Pmod pin only when sw[0]
  assign JA[7:1] = 7'bz;
  assign led[0] = JA[0];
  assign led[1] = JA[1];
  assign led[15:2] = '0;
endmodule
