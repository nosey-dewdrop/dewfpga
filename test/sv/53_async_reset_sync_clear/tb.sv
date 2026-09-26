module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .btnU(btnU), .led(led));
  initial begin
    #1 btnC = 1; #1 btnC = 0; #1
    if (!(led === 16'd0)) begin $display("FAIL: async reset without a clock edge (led=%h)", led); $finish; end
    tick; tick; tick;
    if (!(led === 16'd3)) begin $display("FAIL: counts 3 (led=%h)", led); $finish; end
    btnU = 1; #1
    if (!(led === 16'd3)) begin $display("FAIL: btnU waits for the clock (led=%h)", led); $finish; end
    tick; btnU = 0;
    if (!(led === 16'd0)) begin $display("FAIL: btnU clears on the edge (led=%h)", led); $finish; end
    tick; tick; #2 btnC = 1; #1
    if (!(led === 16'd0)) begin $display("FAIL: async reset mid-cycle (led=%h)", led); $finish; end
    btnC = 0; tick;
    if (!(led === 16'd1)) begin $display("FAIL: counts again (led=%h)", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
