module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  integer i;
  initial begin
    btnC = 1; tick; btnC = 0; #1
    for (i = 0; i < 9; i = i + 1) begin      // IDLE, RUN, DONE, IDLE, ...
      if (led !== 16'(i % 3)) begin $display("FAIL: after %0d edges led=%h, want %0d", i, led, i % 3); $finish; end
      tick; #1;
    end
    $display("PASS"); $finish;
  end
endmodule
