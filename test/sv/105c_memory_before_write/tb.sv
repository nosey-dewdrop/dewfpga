// every word reads 0 before the first write, as on the board; then a write and a read back
module tb;
  logic clk = 1'b0, btnU = 1'b0;
  logic [15:0] sw = 16'h0000;
  logic [15:0] led;
  top dut(.clk(clk), .btnU(btnU), .sw(sw), .led(led));
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i;
  initial begin
    #1;
    for (i = 0; i < 4; i++) begin sw[3:2] = i; #1 if (led !== 16'h0000) begin $display("FAIL: before any write mem[%0d] reads %b, expected 0 (the board's LUT RAM starts at 0)", i, led[7:0]); $finish; end end
    sw = 16'hA500; btnU = 1'b1; tick; btnU = 1'b0; sw[3:2] = 2'd0; #1
    if (led !== 16'h00A5) begin $display("FAIL: mem[0] after the write reads %b, expected a5", led[7:0]); $finish; end
    sw[3:2] = 2'd1; #1 if (led !== 16'h0000) begin $display("FAIL: mem[1] reads %b, expected 0", led[7:0]); $finish; end
    $display("PASS"); $finish;
  end
endmodule
