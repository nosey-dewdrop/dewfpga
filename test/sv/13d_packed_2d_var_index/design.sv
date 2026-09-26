module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0][3:0] grid;                            // a 4x4 LED matrix, one packed 2-D array
  always_ff @(posedge clk)
    for (int i = 0; i < 4; i++)
      for (int j = 0; j < 4; j++)
        grid[i][j] <= sw[4*i + j];                  // a variable index, then a bit select
  assign led[11:0]  = grid[2:0];
  assign led[12]    = grid[sw[13:12]][sw[15:14]];   // one cell, picked by four switches
  assign led[15:13] = grid[sw[13:12]][3:1];         // part of the row two switches pick
endmodule
