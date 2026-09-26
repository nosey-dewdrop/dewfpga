module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a [0:3], b [0:3];
  always_comb for (int i = 0; i < 4; i++) a[i] = sw[4*i +: 4];
  always_ff @(posedge clk) b <= a;               // one whole unpacked array assigned to another
  assign led = {b[3], b[2], b[1], b[0]};
endmodule
