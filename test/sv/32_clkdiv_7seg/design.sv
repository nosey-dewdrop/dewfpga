module hex7(input logic [3:0] x, output logic [6:0] seg);
  always_comb
    case (x)                              // ROM via case
      4'h0: seg = 7'b1000000; 4'h1: seg = 7'b1111001; 4'h2: seg = 7'b0100100; 4'h3: seg = 7'b0110000;
      4'h4: seg = 7'b0011001; 4'h5: seg = 7'b0010010; 4'h6: seg = 7'b0000010; 4'h7: seg = 7'b1111000;
      4'h8: seg = 7'b0000000; 4'h9: seg = 7'b0010000; 4'hA: seg = 7'b0001000; 4'hB: seg = 7'b0000011;
      4'hC: seg = 7'b1000110; 4'hD: seg = 7'b0100001; 4'hE: seg = 7'b0000110; default: seg = 7'b0001110;
    endcase
endmodule
module top(input logic clk, input logic btnC, input logic [15:0] sw,
           output logic [6:0] seg, output logic dp, output logic [3:0] an);
  logic divcnt, slow;                     // clock divider: a derived clock, CS223 style
  always_ff @(posedge clk)
    if (btnC) begin divcnt <= 1'b0; slow <= 1'b0; end
    else begin divcnt <= divcnt + 1'b1; if (divcnt) slow <= ~slow; end
  logic [1:0] digit;
  always_ff @(posedge slow or posedge btnC)
    if (btnC) digit <= 2'd0; else digit <= digit + 2'd1;
  logic [3:0] nib;
  always_comb
    case (digit)
      2'd0:    begin an = 4'b1110; nib = sw[3:0];   end
      2'd1:    begin an = 4'b1101; nib = sw[7:4];   end
      2'd2:    begin an = 4'b1011; nib = sw[11:8];  end
      default: begin an = 4'b0111; nib = sw[15:12]; end
    endcase
  hex7 u_hex (.x(nib), .seg(seg));
  assign dp = 1'b1;
endmodule
