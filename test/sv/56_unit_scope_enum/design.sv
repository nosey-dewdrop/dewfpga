typedef enum logic [1:0] {S0, S1, S2} statetype;   // declared outside the module (compilation-unit scope), textbook state names
module top(input logic clk, input logic btnC, output logic [15:0] led);
  statetype state;
  always_ff @(posedge clk)
    if (btnC) state <= S0;
    else case (state)
      S0: state <= S1;
      S1: state <= S2;
      default: state <= S0;
    endcase
  assign led = {14'b0, state};
endmodule
