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
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin

    sw = 16'h0005; btnC = 1; tick; #1 expect_led(16'h0005, "load 5 while btnC held, after a clock");
    btnC = 0; tick; #1 expect_led(16'h0006, "count after load");
    sw = 16'h0009; btnC = 1; tick; #1 expect_led(16'h0009, "load 9");
    btnC = 0; tick; tick; #1 expect_led(16'h000B, "two counts after second load");
    if (fails == 0) $display("PASS"); else $display("FAIL: %0d checks", fails);
    $finish;
  end
endmodule
