// a state machine with a synchronous reset and no start value, read at the first clock edge, before any reset:
// the board starts the register at its reset value (IDLE, code 0) and moves to RUN at the first edge
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
  state_t state, next;
  always_ff @(posedge clk)
    if (btnC) state <= IDLE;
    else      state <= next;
  always_comb begin
    next = state;
    case (state)
      IDLE:    next = RUN;
      RUN:     next = DONE;
      DONE:    if (sw[0]) next = IDLE;
      default: next = IDLE;
    endcase
  end
  assign led = (state == RUN) ? 16'hFFFF : '0;
endmodule
