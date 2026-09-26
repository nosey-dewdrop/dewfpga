module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    unique if (sw[8]) led[0] = 1'b1; else led[0] = 1'b0;
    priority if (sw[9]) led[1] = 1'b1; else if (sw[10]) led[1] = 1'b0; else led[1] = 1'b1;
    led[15:2] = '0;
  end
endmodule
