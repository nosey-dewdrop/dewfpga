module top(input logic [15:0] sw, output logic [15:0] led, inout wire [7:0] JA);
  assign JA[0] = sw[0] ? sw[1] : 1'bz;   // JA[0] bidirectional
  assign led[0] = JA[0];
  assign led[1] = JA[1];                 // JA[1] only read, never assigned (no 'z' written)
  assign led[15:2] = '0;
endmodule
