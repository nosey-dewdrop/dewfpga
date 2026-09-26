module tb;
  logic [15:0] sw = 0; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 16; i++) begin
      sw = {12'hfff, i[3:0]};                           // digits.mem holds i * 11 + 1 at address i
      #1 if (led !== 16'(i * 11 + 1)) begin bad++; if (bad < 4) $display("FAIL: address %0d led=%h", i, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 16", bad);
    $finish;
  end
endmodule
