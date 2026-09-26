module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i, b, c;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      c = 0; for (b = 0; b < 16; b = b + 1) c = c + sw[b];
      if (!(led === {10'b0, sw[15], 5'(c)})) begin $display("FAIL: do-while popcount, and a body that runs once (sw=%h led=%h want %0d, %b)", sw, led, c, sw[15]); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
