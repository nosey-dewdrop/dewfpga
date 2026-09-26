module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i; reg w0, w1;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      w0 = sw[7] & ~sw[4] & ~sw[1] & sw[0];
      w1 = ~(sw[13] & sw[12] & ~sw[11]);
      if (!(led === {14'd0, w1, w0})) begin $display("FAIL: ==? and !=? (sw=%h led=%h want %b%b)", sw, led, w1, w0); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
