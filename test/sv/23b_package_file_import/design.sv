package cs223_pkg;
  typedef enum logic [1:0] {A, B, C} mode_t;
  parameter int W = 4;
  localparam logic [W-1:0] MAGIC = 4'hA;
  function automatic logic [W-1:0] twice(input logic [W-1:0] x);
    twice = x << 1;
  endfunction
endpackage
import cs223_pkg::*;
module top(input logic [15:0] sw, output logic [15:0] led);
  mode_t m;
  assign m = mode_t'(sw[1:0]);
  assign led[3:0]   = twice(sw[7:4]);
  assign led[7:4]   = cs223_pkg::MAGIC;
  assign led[9:8]   = (m == B) ? 2'd3 : 2'd0;
  assign led[15:10] = '0;
endmodule
