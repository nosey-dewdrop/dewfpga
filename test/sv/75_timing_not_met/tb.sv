module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i; reg [13:0] v;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #2000000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  // every 14-bit value: load it with btnC, one clock for the digits, then compare
  initial begin
    for (i = 0; i < 16384; i = i + 1) begin
      v = i; sw = {~v[1:0], v}; btnC = 1'b1; tick; btnC = 1'b0; sw = ~sw; tick; #1
      if (!(led === {4'(v / 1000), 4'((v / 100) % 10), 4'((v / 10) % 10), 4'(v % 10)})) begin $display("FAIL: decimal digits of %0d (led=%h)", v, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
