// a 3-state FSM read before its first reset: the netlist starts a register without a start value as the
// bitstream does (the three one-hot FDRE yosys makes of the enum at 0, which is none of the states), where the RTL has x
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
  state_t state, next;
  always_ff @(posedge clk)
    if (btnC) state <= IDLE;
    else      state <= next;
  always_comb
    case (state)
      IDLE:    if (sw[0]) next = RUN; else next = IDLE;
      RUN:     next = DONE;
      DONE:    if (sw[0]) next = DONE; else next = IDLE;
      default: next = IDLE;
    endcase
  always_comb
    if (state == DONE) led = 16'hFFFF;
    else               led = '0;
endmodule
