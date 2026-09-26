module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] sum;
  assign sum = sw[3:0] + sw[7:4];
  assign led[3:0] = summ;               // typo: summ is never declared
  assign led[15:4] = '0;
endmodule
