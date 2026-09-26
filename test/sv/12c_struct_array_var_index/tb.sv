module tb;
  logic [15:0] sw; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0; logic [7:0] car;
  initial begin
    for (i = 0; i < 65536; i++) begin
      sw = i; #1;
      car = sw[15] ? sw[15:8] : sw[7:0];                     // x is the upper nibble of a car, y the lower
      if (led !== {8'd0, car[3:0], car[7:4]}) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%h", sw, led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 65536", bad);
    $finish;
  end
endmodule
