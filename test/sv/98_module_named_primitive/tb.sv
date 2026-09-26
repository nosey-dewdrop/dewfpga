module tb;
  logic [15:0] sw = 0; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 64; i++) begin
      sw = (i < 32) ? 16'(i) : $random;
      #1 if (led !== {sw[15:1], ~sw[0]}) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 64", bad);
    $finish;
  end
endmodule
