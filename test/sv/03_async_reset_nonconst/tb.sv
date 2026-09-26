module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    sw = 16'h0005; btnC = 1; #1
    if (!(led[3:0] === 4'd5)) begin $display("FAIL: async load of 5 (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    btnC = 0; #1 tick;
    if (!(led[3:0] === 4'd6)) begin $display("FAIL: count after load (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    sw = 16'h0009; btnC = 1; #1
    if (!(led[3:0] === 4'd9)) begin $display("FAIL: async load of 9 (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    btnC = 0; #1 tick; tick;
    if (!(led[3:0] === 4'd11)) begin $display("FAIL: count after second load (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
