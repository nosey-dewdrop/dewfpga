// four registers read before the first clock edge: a sync reset to 5, an async reset to 4'b1010, no reset, a
// start value in the declaration. The board starts each at its reset value, at 0 without one, at the declared value
module top(input logic clk, input logic btnC, input logic btnU, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a;            // synchronous reset to 5: the board starts it at 5 (bits 0 and 2 are FDSE, 1 and 3 FDRE)
  logic [3:0] b;            // asynchronous reset to 4'b1010: starts at 4'b1010 (FDPE and FDCE)
  logic [3:0] c;            // no reset: starts at 0
  logic [3:0] d = 4'd9;     // a declared start value: starts at 9 in every tool
  always_ff @(posedge clk) if (btnC) a <= 4'd5; else a <= a + 1;
  always_ff @(posedge clk or posedge btnU) if (btnU) b <= 4'b1010; else b <= b - 1;
  always_ff @(posedge clk) c <= sw[3:0];
  always_ff @(posedge clk) if (btnC) d <= 0; else d <= d + 1;
  assign led = {a, b, c, d};
endmodule
