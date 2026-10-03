module top(input logic [15:0] sw, output logic [15:0] led);
  logic q;
  always_comb begin
    if (sw[1]) q = sw[0];
    else       q = 1'b0;
  end
  assign led[0] = q;
  assign led[15:1] = '0;
endmodule
