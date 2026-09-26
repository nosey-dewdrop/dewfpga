module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .sw(sw), .led(led));
  initial begin
    sw = 16'h0052; tick;
    if (!(led === 16'h340F)) begin $display("FAIL: rom[2]=0F, rom[5]=34 (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h00FA; tick;
    if (!(led === 16'h89DE)) begin $display("FAIL: rom[A]=DE, rom[F]=89 (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
