module top(input logic clk, input logic btnC, input logic btnU, output logic [15:0] led);
  logic [3:0] q;
  always_ff @(posedge clk, posedge btnC)   // btnC: asynchronous reset
    if (btnC || btnU) q <= 4'd0;         // btnU: a synchronous clear, in the same branch
    else              q <= q + 4'd1;
  assign led = {12'd0, q};
endmodule
