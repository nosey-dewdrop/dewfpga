module tb;
  logic clk = 0, btnC = 1; logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .led(led));
  always #5 clk = ~clk;
  integer i, bad = 0;
  initial begin
    @(posedge clk); #1 btnC = 0;
    for (i = 1; i <= 40; i++) begin
      @(posedge clk); #1;
      if (led !== 16'(i / 4)) begin bad++; if (bad < 4) $display("FAIL: after %0d clocks led=%0d, want %0d", i, led, i / 4); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 40", bad);
    $finish;
  end
endmodule
