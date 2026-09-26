module top(input logic [15:0] sw, output logic [6:0] seg, output logic [3:0] an);
  // the digits 0-3 as seven-segment patterns (active low), one packed 2-D localparam
  localparam logic [3:0][6:0] SEG = {7'b0110000, 7'b0100100, 7'b1111001, 7'b1000000};
  assign seg = SEG[sw[1:0]];
  assign an  = 4'b1110;
endmodule
