// one clock edge with no reset: the board is in RUN (led all on); then reset and the usual run
module tb;
  logic clk = 1'b0, btnC = 1'b0;
  logic [15:0] sw = 16'h0001;
  logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  initial begin
    #1 if (led !== 16'h0000) begin $display("FAIL: before the first edge led=%b, expected all off (IDLE, the reset value the board starts in)", led); $finish; end
    tick;
    if (led !== 16'hFFFF) begin $display("FAIL: after the first edge, no reset pressed, led=%b, expected all on (RUN: the board starts in IDLE and moves on)", led); $finish; end
    tick;
    if (led !== 16'h0000) begin $display("FAIL: in DONE led=%b", led); $finish; end
    btnC = 1'b1; tick; btnC = 1'b0;
    if (led !== 16'h0000) begin $display("FAIL: after reset led=%b", led); $finish; end
    tick;
    if (led !== 16'hFFFF) begin $display("FAIL: RUN after reset led=%b", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
