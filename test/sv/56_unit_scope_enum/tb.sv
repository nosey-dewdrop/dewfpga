module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .led(led));
  initial begin
    btnC = 1; tick; btnC = 0;
    if (!(led === 16'd0)) begin $display("FAIL: reset to S0 (led=%h)", led); $finish; end
    tick; if (!(led === 16'd1)) begin $display("FAIL: S0 to S1 (led=%h)", led); $finish; end
    tick; if (!(led === 16'd2)) begin $display("FAIL: S1 to S2 (led=%h)", led); $finish; end
    tick; if (!(led === 16'd0)) begin $display("FAIL: S2 to S0 (led=%h)", led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
