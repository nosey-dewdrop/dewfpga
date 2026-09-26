module tb;
  logic [4:1] sw = 0; logic [4:1] led;
  top dut(.sw(sw), .led(led));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 16; i++) begin sw = i[3:0]; #1 if (led !== ~sw) bad++; end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 16", bad);
    $finish;
  end
endmodule
