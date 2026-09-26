module tb;
  logic clk = 0, btnC = 1; logic [15:0] sw = 16'ha5a5; logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    #5 clk = 1; #5 clk = 0; btnC = 0;
    for (i = 1; i <= 40; i++) begin
      #5 clk = 1; #5 clk = 0;
      if (led !== {sw[15:4], i[3:0]}) begin bad++; if (bad < 4) $display("FAIL: after %0d edges led=%h", i, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 40", bad);
    $finish;
  end
endmodule
