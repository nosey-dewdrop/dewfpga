module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [15:0] num;
  initial num = sw;                          // a start value read from the switches
  always_ff @(posedge clk)
    if (btnC) num <= sw;
    else      num <= num + 16'd1;
  assign led = num;
endmodule
