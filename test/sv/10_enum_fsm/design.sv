module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {IDLE = 2'b00, RUN = 2'b01, DONE = 2'b11} state_t;   // explicit base type
  typedef enum {RED, GREEN, YELLOW} light_t;                                     // default base type (int)
  state_t s, ns;
  light_t l;
  always_ff @(posedge clk)
    if (btnC) begin s <= IDLE; l <= RED; end
    else begin s <= ns; l <= (l == YELLOW) ? RED : light_t'(l + 1); end
  always_comb begin
    ns = s;
    case (s)
      IDLE: if (sw[0]) ns = RUN;
      RUN:  ns = DONE;
      DONE: if (!sw[0]) ns = IDLE;
      default: ns = IDLE;
    endcase
  end
  assign led = {10'd0, l[1:0], 2'd0, s};
endmodule
