module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  // the reference in plain numbers: IDLE=0, RUN=1, DONE=3; RED=0, GREEN=1, YELLOW=2
  integer s, l, i;
  reg [39:0] pattern = 40'b1100_1110_0111_0001_1011_0000_1111_0101_0011_1001;
  initial begin
    btnC = 1; tick; btnC = 0; #1 s = 0; l = 0;
    if (!(led === 16'h0000)) begin $display("FAIL: reset (led=%h)", led); $finish; end
    for (i = 0; i < 40; i = i + 1) begin
      sw[0] = pattern[i]; tick; #1
      case (s)
        0: s = sw[0] ? 1 : 0;
        1: s = 3;
        3: s = sw[0] ? 3 : 0;
      endcase
      l = (l == 2) ? 0 : l + 1;
      if (!(led === {10'd0, l[1:0], 2'd0, s[1:0]})) begin $display("FAIL: step %0d sw[0]=%b: led=%h, want state %0d light %0d", i, sw[0], led, s, l); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
