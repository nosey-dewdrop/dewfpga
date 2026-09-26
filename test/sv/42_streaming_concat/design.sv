module top(input logic [15:0] sw, output logic [15:0] led);
  assign led[7:0]  = {<<{sw[7:0]}};     // streaming concatenation: the bits in reverse order
  assign led[15:8] = {<<4{sw[15:8]}};   // slices of 4: the two nibbles swapped
endmodule
