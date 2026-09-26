module top(input logic clk, input logic btnC, input logic btnU, input logic [15:0] sw, output logic [15:0] led);
  logic rst_n;
  logic [3:0] c_sync, c_async, c_set;
  assign rst_n = sw[15];
  always_ff @(posedge clk)                      // sync, active high
    if (btnC) c_sync <= '0; else c_sync <= c_sync + 4'd1;
  always_ff @(posedge clk or negedge rst_n)     // async, active low
    if (!rst_n) c_async <= '0; else c_async <= c_async + 4'd1;
  always_ff @(posedge clk or posedge btnU)      // async set to a nonzero constant
    if (btnU) c_set <= 4'hA; else c_set <= c_set - 4'd1;
  assign led = {4'd0, c_set, c_async, c_sync};
endmodule
