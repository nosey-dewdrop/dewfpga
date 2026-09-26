module fsm(input logic clk, input logic reset, input logic go, output logic busy);
  typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
  state_t state;
  always_ff @(posedge clk, posedge reset)
    if (reset) state <= IDLE;
    else case (state)
      IDLE:    if (go) state <= RUN;
      RUN:     state <= DONE;
      default: state <= IDLE;
    endcase
  assign busy = (state == RUN);
endmodule
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  fsm u_fsm (.clk(clk), .reset(btnC), .go(sw[0]), .busy(led[15]));
  assign led[1:0] = u_fsm.state;        // a hierarchical name: the FSM's state on two LEDs
  assign led[14:2] = '0;
endmodule
