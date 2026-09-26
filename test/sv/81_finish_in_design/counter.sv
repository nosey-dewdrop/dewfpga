module counter(input logic clk, input logic btnC, output logic [15:0] led);   // its ports have the XDC's names
  always_ff @(posedge clk) if (btnC) led <= '0; else led <= led + 16'd1;
endmodule
