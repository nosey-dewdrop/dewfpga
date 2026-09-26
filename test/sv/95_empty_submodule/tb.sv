module tb;
  // part 1, the switches on led[15:1], is what is written so far; led[0] waits for part 2
  logic clk = 0; logic [15:0] sw = 0; logic [15:0] led;
  top dut(.clk(clk), .sw(sw), .led(led));
  always #5 clk = ~clk;
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 300; i++) begin
      sw = (i < 16) ? 16'(1 << i) : $random;
      @(negedge clk); if (led[15:1] !== sw[15:1]) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 300", bad);
    $finish;
  end
endmodule
