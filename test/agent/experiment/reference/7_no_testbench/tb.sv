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
  top dut(.clk(clk), .sw(sw), .led(led));
  initial begin

    sw = 16'h0102; tick; #1 expect_led(16'h0003, "1 + 2");
    sw = 16'hFFFF; tick; #1 expect_led(16'h01FE, "255 + 255 keeps the carry");
    sw = 16'h8000; #1 expect_led(16'h01FE, "no change before the clock");
    tick; #1 expect_led(16'h0080, "128 + 0");
    if (fails == 0) $display("PASS"); else $display("FAIL: %0d checks", fails);
    $finish;
  end
endmodule
