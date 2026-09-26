module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] n [0:3];
  always_comb foreach (n[i]) n[i] = sw[4*i +: 4] + 4'(i);   // one pass per element of n
  assign led = {n[3], n[2], n[1], n[0]};
endmodule
