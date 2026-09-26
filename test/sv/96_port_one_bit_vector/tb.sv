module tb;
  logic [0:0] sw = 0; logic [0:0] led;
  top dut(.sw(sw), .led(led));
  integer bad = 0;
  initial begin
    sw = 1'b0; #1 if (led !== 1'b1) bad++;
    sw = 1'b1; #1 if (led !== 1'b0) bad++;
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 2", bad);
    $finish;
  end
endmodule
