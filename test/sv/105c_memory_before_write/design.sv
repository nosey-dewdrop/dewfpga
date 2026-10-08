// a memory read before anything is written to it: the board's LUT RAM starts at 0
module top(input logic clk, input logic btnU, input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] mem [0:3];
  always_ff @(posedge clk) if (btnU) mem[sw[1:0]] <= sw[15:8];
  assign led = {8'd0, mem[sw[3:2]]};
endmodule
