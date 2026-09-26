module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .btnU(btnU), .sw(sw), .led(led));
  initial begin
    sw = 16'h0000; btnU = 1; #1 btnC = 1; tick; btnC = 0; btnU = 0; sw = 16'h8000; #1
    if (!(led === 16'h0A00)) begin $display("FAIL: after resets (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    tick; tick; tick;
    if (!(led === 16'h0733)) begin $display("FAIL: 3 clocks (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h0000; #1
    if (!(led === 16'h0703)) begin $display("FAIL: async clear without clock (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
