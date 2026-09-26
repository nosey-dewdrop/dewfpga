module tb;
  logic [15:0] sw; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, k, bad = 0; logic [3:0] want;
  initial begin
    for (i = 0; i < 256; i++) begin
      sw = {i[7:0] ^ 8'h5a, i[7:0]}; #1;
      want = 0; for (k = 0; k < 8; k++) want = want + sw[k];
      if (led !== {sw[15:8], 4'd0, want}) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 256", bad);
    $finish;
  end
endmodule
