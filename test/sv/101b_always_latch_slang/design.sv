module top(input logic [15:0] sw, output logic [15:0] led);
  logic q;
  logic [3:0] n [0:3];
  always_latch if (sw[1]) q = sw[0];   // a latch on purpose: sw[1] is its gate
  always_comb foreach (n[i]) n[i] = sw[4*i +: 4] + 4'(i);   // foreach: yosys' own reader refuses it, yosys-slang reads it
  assign led = {n[3], n[2], n[1], n[0][3:1], q};
endmodule
