module sub(input logic [3:0] a, output logic [3:0] y);
  import cfg_pkg::*;
  assign y = twice(a) ^ MAGIC;
endmodule
