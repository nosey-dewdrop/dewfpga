module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q = '0;
  always_ff @(posedge clk) begin
    if (btnC) q <= '0; else q <= q + 4'd1;
    if (q == 4'd15) $display("wrapped");  // a debug print left in the design
  end
  assign led = {sw[15:4], q};
endmodule
