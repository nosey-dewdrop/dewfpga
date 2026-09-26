module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] sum = sw[3:0] + sw[7:4];    // meant as the sum of two nibbles; the standard makes it a start value
  assign led = {12'd0, sum};
endmodule
