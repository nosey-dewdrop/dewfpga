module tb;
  logic [15:0] sw; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 256; i++) begin
      sw = {i[7:0] ^ 8'h3c, i[7:0]}; #1;
      if (led !== {sw[7:0], sw[15:8]}) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 256", bad);
    $finish;
  end
endmodule
