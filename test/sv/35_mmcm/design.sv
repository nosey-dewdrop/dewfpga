module top(input logic clk, input logic btnC, output logic [15:0] led);
  logic clk_fb, clk_out, clk50, locked;
  logic [7:0] cnt;
  MMCME2_BASE #(.CLKIN1_PERIOD(10.0), .CLKFBOUT_MULT_F(10.0), .DIVCLK_DIVIDE(1), .CLKOUT0_DIVIDE_F(20.0))
    u_mmcm (.CLKIN1(clk), .CLKFBIN(clk_fb), .CLKFBOUT(clk_fb), .CLKOUT0(clk_out), .LOCKED(locked),
            .PWRDWN(1'b0), .RST(btnC),
            .CLKFBOUTB(), .CLKOUT0B(), .CLKOUT1(), .CLKOUT1B(), .CLKOUT2(), .CLKOUT2B(),
            .CLKOUT3(), .CLKOUT3B(), .CLKOUT4(), .CLKOUT5(), .CLKOUT6());
  BUFG u_bufg (.I(clk_out), .O(clk50));
  always_ff @(posedge clk50 or negedge locked)
    if (!locked) cnt <= '0; else cnt <= cnt + 8'd1;
  assign led = {locked, 7'd0, cnt};
endmodule
