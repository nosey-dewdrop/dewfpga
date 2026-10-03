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
  top dut(.clk(clk), .btnU(btnU), .btnC(btnC), .led(led));
  initial begin

    #1 tick;
    btnU = 1; tick; tick; btnU = 0; tick; #1 expect_led(16'h0001, "one press, held two clocks, counts once");
    btnU = 1; tick; btnU = 0; tick; #1 expect_led(16'h0002, "second press");
    btnC = 1; btnU = 1; tick; #1 expect_led(16'h0000, "clear wins over a press");
    btnC = 0; btnU = 0; tick; #1 expect_led(16'h0000, "stays cleared");
    if (fails == 0) $display("PASS"); else $display("FAIL: %0d checks", fails);
    $finish;
  end
endmodule
