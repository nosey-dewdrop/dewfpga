module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  wire [15:0] led;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  top dut(.clk(clk), .btnC(btnC), .led(led));
  integer i;
  initial begin
    btnC = 1; tick; btnC = 0;
    // blink toggles on every 10th edge: edges 10, 20, 30, ...
    for (i = 1; i <= 60; i = i + 1) begin
      tick; #1
      if (led !== {15'd0, 1'((i / 10) % 2)}) begin $display("FAIL: after %0d edges led=%h", i, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
