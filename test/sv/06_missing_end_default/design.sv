module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {S0, S1, S2} st_t;
  st_t state, nextstate;
  logic [3:0] cnt, nextCnt;
  always_ff @(posedge clk)
    if (btnC) begin state <= S0; cnt <= 0; end
    else begin state <= nextstate; cnt <= nextCnt; end
  always_comb
    case (state)
      S0: begin nextstate = sw[0] ? S1 : S0; nextCnt = cnt; end
      S1: begin nextstate = S2; nextCnt = 0; end
      S2: begin                   // this begin is never closed
        nextstate = S2; nextCnt = cnt;
        if (cnt <= 4'd5) begin
          nextCnt = cnt + 1;
        end
      default: nextstate = S0;    // so the parser meets 'default' inside S2's block
    endcase
  assign led = {10'd0, state, cnt};
endmodule
