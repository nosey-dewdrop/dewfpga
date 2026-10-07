// a set register (FDSE) read before its first reset: the netlist starts a register without a start value as
// the bitstream does (FDSE at 1), where the RTL has x
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic armed;                      // set by the reset button, cleared by sw[0]
  logic [15:0] cnt;
  always_ff @(posedge clk)
    if (btnC)       armed <= 1'b1;
    else if (sw[0]) armed <= 1'b0;
  always_ff @(posedge clk)
    if (btnC)       cnt <= '0;
    else if (!armed) cnt <= cnt + 16'd1;
  always_comb
    if (!armed) led = cnt;
    else        led = 16'hFFFF;
endmodule
