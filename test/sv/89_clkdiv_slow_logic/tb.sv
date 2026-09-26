module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #20000000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  integer i, v; reg [15:0] want;
  // two edges of the slow clock (32 board clocks each): value loads on the first, the digits on the second
  task slow_edges; begin repeat (64) tick; end endtask
  initial begin
    for (i = 0; i < 300; i = i + 1) begin
      v = i == 0 ? 0 : i == 1 ? 9999 : i == 2 ? 16383 : i == 3 ? 1000 : $urandom % 16384;
      sw = v; btnC = 1; slow_edges; btnC = 0; slow_edges;
      want = {4'(v / 1000), 4'((v / 100) % 10), 4'((v / 10) % 10), 4'(v % 10)};
      if (led !== want) begin $display("FAIL: value %0d: led=%h, want %h", v, led, want); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
