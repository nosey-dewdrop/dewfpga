module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  integer fails = 0;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  task expect_led(input [15:0] want, input [8*40-1:0] what);
    begin if (led !== want) begin $error("%0s: led=%h want %h", what, led, want); fails = fails + 1; end end
  endtask
  initial begin #200000 $error("timeout"); $finish; end
  top dut(.clk(clk), .sw(sw), .seg(seg), .dp(dp), .an(an));
  initial begin

    sw = 16'h03A5; #1
    if (!(seg === 7'b1011010 && dp === 1'b1 && an === 4'b1100)) begin $error("port values seg=%b dp=%b an=%b", seg, dp, an); fails = fails + 1; end
    if (fails == 0) $display("PASS"); else $display("FAIL: %0d checks", fails);
    $finish;
  end
endmodule
