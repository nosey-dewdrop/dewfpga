module tb;
  logic clk = 0, btnC = 0; logic [15:0] sw = 0; logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  always #5 clk = ~clk;
  integer i, bad = 0;
  initial begin
    btnC = 1;                                   // write address a with a * 7 + 3 (low byte)
    for (i = 0; i < 256; i++) begin sw = {i[7:0], 8'(i * 7 + 3)}; @(negedge clk); end
    btnC = 0;                                   // read every address back, in another order
    for (i = 0; i < 256; i++) begin
      sw = {8'(i * 37), 8'hff}; @(negedge clk);
      if (led !== {8'h00, 8'(i * 37 * 7 + 3)}) begin bad++; if (bad < 4) $display("FAIL: address %0d led=%h", 8'(i * 37), led); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 256", bad);
    $finish;
  end
endmodule
