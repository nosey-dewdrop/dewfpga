module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    btnC = 1; sw = 16'h035A; tick; sw = 16'h07C3; tick; btnC = 0;
    sw = 16'h3000; #1
    if (!(led[7:0] === 8'h5A)) begin $display("FAIL: ram[3] (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h7000; #1
    if (!(led[7:0] === 8'hC3)) begin $display("FAIL: ram[7] (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
