module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .led(led));
  initial begin
    btnC = 1; repeat (10) tick; btnC = 0; repeat (5000) tick;
    if (!(led[15] === 1'b1 && led[7:0] !== 8'd0)) begin $display("FAIL: MMCM locked and 50 MHz counter running (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
