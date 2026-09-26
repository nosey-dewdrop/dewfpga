// a lab mid-way: part 2's module is declared and instantiated, its body not written yet
module blinker(input logic clk, output logic led);
  // part 2 of the lab: not written yet
endmodule
module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic b;
  blinker u_blink(.clk(clk), .led(b));
  assign led = {sw[15:1], b};
endmodule
