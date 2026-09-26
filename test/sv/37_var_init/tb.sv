module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .led(led));
  initial begin
    #1
    if (!(led === 16'h0095)) begin $display("FAIL: power-up values (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    tick;
    if (!(led === 16'h0086)) begin $display("FAIL: after one clock (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
