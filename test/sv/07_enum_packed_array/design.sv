module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {S0, S1, S2} statetype;
  statetype [1:0] state, nextstate;     // packed array of enums (seen in a CS223 lab that Vivado built)
  always_ff @(posedge clk)
    if (btnC) state <= S0; else state <= nextstate;
  always_comb
    case (state)
      S0: nextstate = sw[0] ? S1 : S0;
      S1: nextstate = S2;
      S2: nextstate = S0;
      default: nextstate = S0;
    endcase
  assign led = {12'd0, state};
endmodule
