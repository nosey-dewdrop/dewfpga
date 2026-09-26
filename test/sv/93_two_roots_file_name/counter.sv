// A lab folder as the course's Vivado projects leave it: one file named after the plain counter, which the
// testbench-less part of the lab simulates, and the board version next to it, which the project names as its
// top. Nothing instantiates either, so both could be the top.
module counter(input logic clk, input logic btnC, output logic [15:0] led);
  always_ff @(posedge clk) if (btnC) led <= 16'd0; else led <= led + 16'd1;
endmodule
// the board version: one step every four clocks (the lab divides the clock further; a clock enable keeps it simple)
module top(input logic clk, input logic btnC, output logic [15:0] led);
  logic [1:0] div;
  always_ff @(posedge clk) div <= btnC ? 2'd0 : div + 2'd1;
  always_ff @(posedge clk)
    if (btnC) led <= 16'd0;
    else if (div == 2'd3) led <= led + 16'd1;
endmodule
