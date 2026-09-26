module top(input logic clk, input logic btnC, output logic [15:0] led);
  typedef enum logic [1:0] {IDLE = 2'd0, RUN = 2'd1, DONE = 2'd3} state_t;
  state_t s;
  always_ff @(posedge clk)
    if (btnC) s <= s.first(); else s <= s.next();
  assign led = {13'd0, (s == s.last()), s};
endmodule
