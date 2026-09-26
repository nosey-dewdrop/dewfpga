module tb;
  logic [15:0] sw = 0; logic [15:0] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 512; i++) begin
      sw = {i[0] ? 8'hff : 8'h00, i[8:1]};        // every value of sw[7:0], with sw[15:8] low and high
      #1 if (led !== 16'(i[8:1] * i[8:1])) begin bad++; if (bad < 4) $display("FAIL: sw=%h led=%0d want %0d", sw, led, i[8:1] * i[8:1]); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 512", bad);
    $finish;
  end
endmodule
