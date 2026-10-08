// led before the first clock edge must be what the board shows: a=0101 b=1010 c=0000 d=1001; then the registers run
module tb;
  logic clk = 1'b0, btnC = 1'b0, btnU = 1'b0;
  logic [15:0] sw = 16'h0003;
  logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .btnU(btnU), .sw(sw), .led(led));
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  initial begin
    #1 if (led !== 16'b0101_1010_0000_1001) begin $display("FAIL: before the first edge a=%b b=%b c=%b d=%b, expected 0101 1010 0000 1001 (the board's start: the reset value, 0 without a reset, the declared value)", led[15:12], led[11:8], led[7:4], led[3:0]); $finish; end
    tick;
    if (led !== 16'b0110_1001_0011_1010) begin $display("FAIL: after one edge a=%b b=%b c=%b d=%b, expected 0110 1001 0011 1010", led[15:12], led[11:8], led[7:4], led[3:0]); $finish; end
    btnC = 1'b1; btnU = 1'b1; tick; btnC = 1'b0; btnU = 1'b0;
    if (led !== 16'b0101_1010_0011_0000) begin $display("FAIL: after reset a=%b b=%b c=%b d=%b, expected 0101 1010 0011 0000", led[15:12], led[11:8], led[7:4], led[3:0]); $finish; end
    $display("PASS"); $finish;
  end
endmodule
