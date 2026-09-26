module tb;
  logic [15:0] sw; wire [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, k, bad = 0; logic [3:0] want;
  initial begin
    for (i = 0; i < 65536; i++) begin
      sw = i; #1;
      for (k = 0; k < 4; k++) begin
        want = sw[15 - k] ? sw[4*k +: 4] : 4'bzzzz;       // a nibble that is not enabled floats
        if (led[4*k +: 4] !== want) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
      end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d", bad);
    $finish;
  end
endmodule
