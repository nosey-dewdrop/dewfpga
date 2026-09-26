module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.sw(sw), .led(led));
  initial begin
    sw = 16'h0029; #1
    if (!(led === 16'h0009)) begin $display("FAIL: return a (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h00B2; #1
    if (!(led === 16'h000B)) begin $display("FAIL: return b (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
