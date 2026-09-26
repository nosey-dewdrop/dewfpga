module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  integer i;
  initial begin
    btnC = 1; tick; btnC = 0;
    for (i = 0; i < 40; i = i + 1) begin
      sw = $urandom; #1
      if (led !== {sw[15:4], sw[3:0] ^ 4'(i)}) begin $display("FAIL: after %0d edges sw=%h led=%h", i, sw, led); $finish; end
      tick;
    end
    $display("PASS"); $finish;
  end
endmodule
