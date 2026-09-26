module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .led(led));
  initial begin
    btnC = 1; tick; btnC = 0; #1
    if (!(led[2:0] === 3'b000)) begin $display("FAIL: first() (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    tick;
    if (!(led[2:0] === 3'b001)) begin $display("FAIL: next() -> RUN (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    tick;
    if (!(led[2:0] === 3'b111)) begin $display("FAIL: next() -> DONE, last() (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    tick;
    if (!(led[2:0] === 3'b000)) begin $display("FAIL: next() wraps to IDLE (led=%h seg=%b an=%b)", led, seg, an); $finish; end
    $display("PASS"); $finish;
  end
endmodule
