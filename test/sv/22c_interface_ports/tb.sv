module tb;
  reg clk = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [3:0] want = 4'd0;
  integer i;
  top dut(.clk(clk), .sw(sw), .led(led));
  initial begin
    for (i = 0; i < 40; i = i + 1) begin
      sw = {15'd0, i % 3 != 0}; #1 clk = 1'b1; if (sw[0]) want = want + 4'd1; #1 clk = 1'b0; #1
      if (!(led === {12'd0, want})) begin $display("FAIL: the counter in the interface (i=%0d led=%h, want %h)", i, led, want); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
