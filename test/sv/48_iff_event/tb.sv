module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .sw(sw), .led(led));
  initial begin
    sw = 16'h80A5; tick;
    if (!(led === 16'h00A5)) begin $display("FAIL: sw[15]=1, q loads (led=%h)", led); $finish; end
    sw = 16'h003C; tick; tick;
    if (!(led === 16'h00A5)) begin $display("FAIL: sw[15]=0, q holds (led=%h)", led); $finish; end
    sw = 16'h803C; tick;
    if (!(led === 16'h003C)) begin $display("FAIL: sw[15]=1 again, q loads (led=%h)", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
