module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] ram [0:15];
  always_ff @(posedge clk)
    if (btnC) ram[sw[11:8]] <= sw[7:0];
  assign led[7:0] = ram[sw[15:12]];
  assign led[15:8] = '0;
endmodule
