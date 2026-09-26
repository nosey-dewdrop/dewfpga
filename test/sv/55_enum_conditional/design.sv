module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  typedef enum logic [1:0] {IDLE, RUN, DONE} state_t;
  state_t state, next;
  always_ff @(posedge clk) if (btnC) state <= IDLE; else state <= next;
  always_comb
    case (state)
      IDLE:    next = sw[0] ? RUN : IDLE;    // a conditional between two values of one enum
      RUN:     next = sw[1] ? DONE : RUN;
      default: next = sw[2] ? IDLE : DONE;
    endcase
  assign led = {14'b0, state};
endmodule
