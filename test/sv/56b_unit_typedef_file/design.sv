module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  state_t state;                          // the type comes from types.sv
  always_ff @(posedge clk)
    if (btnC) state <= IDLE;
    else if (state == IDLE) state <= RUN;
    else if (state == RUN) state <= DONE;
    else state <= IDLE;
  assign led = {14'd0, state};
endmodule
