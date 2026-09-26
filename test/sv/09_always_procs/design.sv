module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] cnt, dec;
  logic lat;
  always_ff @(posedge clk)
    if (btnC) cnt <= '0; else cnt <= cnt + 4'd1;
  always_comb begin
    dec = '0;
    dec[sw[1:0]] = 1'b1;
  end
  always_latch
    if (sw[2]) lat <= sw[3];
  assign led = {7'd0, lat, dec, cnt};
endmodule
