module top(input logic [15:0] sw,
           output logic [6:0] seg, [3:0] an);   // an has only a range: it inherits output from seg (a strict reader makes it a net, not logic)
  assign seg = ~sw[6:0];
  always_comb                                    // an written in an always block
    case (sw[9:8])
      2'd0:    an = 4'b1110;
      2'd1:    an = 4'b1101;
      2'd2:    an = 4'b1011;
      default: an = 4'b0111;
    endcase
endmodule
