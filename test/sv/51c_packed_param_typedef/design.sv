module top(input logic [15:0] sw, output logic [6:0] seg, output logic [3:0] an);
  // the same table as 51b, its type named first: a typedef of the packed 2-D array
  typedef logic [3:0][6:0] tab_t;
  localparam tab_t SEG = {7'b0110000, 7'b0100100, 7'b1111001, 7'b1000000};
  assign seg = SEG[sw[1:0]];
  assign an  = 4'b1110;
endmodule
