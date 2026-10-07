// checks led before any clock edge: the RTL's x armed takes the else branch (all on), and so must the
// netlist, which starts the FDSE at 1 as the bitstream does (an INIT forced to 0 would print all off)
module tb;
  logic clk = 1'b0, btnC = 1'b0;
  logic [15:0] sw = 16'h0000;
  logic [15:0] led;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  initial begin
    #1 if (led !== 16'hFFFF) begin $display("FAIL: before the first edge led=%b, expected all on (armed)", led); $finish; end
    btnC = 1'b1; tick; btnC = 1'b0;
    if (led !== 16'hFFFF) begin $display("FAIL: after reset led=%b", led); $finish; end
    sw[0] = 1'b1; tick; sw[0] = 1'b0;
    if (led !== 16'h0000) begin $display("FAIL: disarmed led=%b", led); $finish; end
    tick; tick;
    if (led !== 16'h0002) begin $display("FAIL: counting led=%b", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
