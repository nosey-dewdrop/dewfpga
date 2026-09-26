module tb;
  logic clk = 0; logic [15:0] sw = 0; logic [15:0] led;
  top dut(.clk(clk), .sw(sw), .led(led));
  integer i, bad = 0; logic [3:0] want = 0;
  initial begin
    for (i = 0; i < 64; i++) begin
      sw = $random;
      #5 clk = 1; #5 clk = 0;
      want = want + sw[3:0];
      if (led !== {12'd0, want}) begin bad++; if (bad < 4) $display("FAIL: cycle %0d led=%h want=%h", i, led, want); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 64", bad);
    $finish;
  end
endmodule
