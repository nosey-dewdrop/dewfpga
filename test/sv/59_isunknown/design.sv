module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[0] = $isunknown(sw);           // real switches are never x or z: always 0
  assign led[15:1] = sw[15:1];
endmodule
