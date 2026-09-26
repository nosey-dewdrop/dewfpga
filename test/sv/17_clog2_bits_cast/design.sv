module top(input logic [15:0] sw, output logic [15:0] led);
  localparam int DEPTH = 10;
  localparam int AW = $clog2(DEPTH);
  logic [$clog2(16)-1:0] idx;
  logic [11:0] word;
  assign idx  = sw[3:0];
  assign word = {sw[7:0], idx};
  assign led[4:0]   = $bits(word);
  assign led[7:5]   = AW[2:0];
  assign led[11:8]  = 4'(sw[15:8] + 8'd1) >> 1;   // the cast cuts the sum to 4 bits before the shift
  assign led[15:12] = $bits(idx);
endmodule
