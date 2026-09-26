module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin : find
    led = 16'd16;
    for (int i = 0; i < 16; i++)
      if (sw[i]) begin
        led = i;
        disable find;                  // leave the block at the lowest switch that is up
      end
  end
endmodule
