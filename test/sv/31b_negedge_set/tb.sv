module tb;
  logic clk = 1; logic [15:0] sw = 0; logic [15:0] led;
  top dut(.clk(clk), .sw(sw), .led(led));
  always #5 clk = ~clk;                               // falling edges at 5, 15, 25, ...
  integer i, bad = 0;
  initial begin
    sw = 16'hc000; @(posedge clk); #1;               // no edge yet: nothing set
    @(negedge clk); #1 if (led[3:0] !== 4'hf) begin bad++; $display("FAIL: the set on the falling edge: led=%h", led); end
    sw = 16'h0000;
    for (i = 1; i <= 20; i++) begin
      @(posedge clk); #1 if (led[3:0] !== 4'(15 + i - 1)) begin bad++; if (bad < 4) $display("FAIL: the rising edge moved q: led=%h", led); end
      @(negedge clk); #1 if (led[3:0] !== 4'(15 + i)) begin bad++; if (bad < 4) $display("FAIL: after %0d falling edges led=%h", i, led); end
    end
    sw = 16'h3000; #1 if (led[4] !== 1'b1) begin bad++; $display("FAIL: the preset, before any edge: led=%h", led); end
    sw = 16'h0000; @(negedge clk); #1 if (led[4] !== 1'b0) begin bad++; $display("FAIL: p follows sw[0] on the falling edge: led=%h", led); end
    sw = 16'h0001; @(posedge clk); #1 if (led[4] !== 1'b0) begin bad++; $display("FAIL: p moved on a rising edge: led=%h", led); end
    @(negedge clk); #1 if (led[4] !== 1'b1) begin bad++; $display("FAIL: p follows sw[0] on the falling edge: led=%h", led); end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d checks", bad);
    $finish;
  end
endmodule
