module top(input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] x; logic [3:0] n;
  always_comb begin                       // how many of sw[7:0] are up
    x = sw[7:0]; n = '0;
    repeat (8) begin n = n + x[0]; x = x >> 1; end
  end
  assign led = {sw[15:8], 4'd0, n};
endmodule
