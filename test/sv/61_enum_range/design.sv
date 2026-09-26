module top(input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {S[3]} s_t;        // an enum range: S0, S1, S2 (values 0, 1, 2)
  typedef enum logic [2:0] {T[5:7]} t_t;      // T5, T6, T7 (values 0, 1, 2)
  s_t s; t_t t;
  always_comb
    case (sw[1:0])
      2'd0:    s = S2;
      2'd1:    s = S0;
      default: s = S1;
    endcase
  always_comb
    if (sw[2]) t = T7;
    else       t = T6;
  assign led = {11'd0, t, s};
endmodule
