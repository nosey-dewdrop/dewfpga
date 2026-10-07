module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.sw(sw), .led(led));
  initial begin
    // the gate (s < sw) is open at 16'h2bdc; at 16'h0000 it closes in the same instant the data (sw < 1791) changes
    sw = 16'h2bdc; #1
    if (!(led === 16'h0000)) begin $display("FAIL: step 0: sw=2bdc led=%h, expected 0000", led); $finish; end
    sw = 16'h0000; #1
    if (!(led === 16'h0000)) begin $display("FAIL: step 1: sw=0000 led=%h, expected 0000 (the gate closed as the data changed)", led); $finish; end
    sw = 16'h2bdc; #1
    if (!(led === 16'h0000)) begin $display("FAIL: step 2: sw=2bdc led=%h, expected 0000", led); $finish; end
    sw = 16'h0100; #1
    if (!(led === 16'h0001)) begin $display("FAIL: step 3: sw=0100 led=%h, expected 0001", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
