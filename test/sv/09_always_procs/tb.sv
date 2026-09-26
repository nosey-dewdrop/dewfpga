module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    btnC = 1; tick; btnC = 0; tick; tick; tick;
    if (!(led[3:0] === 4'd3)) begin $display("FAIL: always_ff counter (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h000E; #1
    if (!(led[7:4] === 4'b0100 && led[8] === 1'b1)) begin $display("FAIL: always_comb decoder / always_latch open (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h000A; #1 sw = 16'h0002; #1
    if (!(led[8] === 1'b1)) begin $display("FAIL: always_latch hold (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
