module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i; reg [3:0] q, d;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #2000000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    #1 btnC = 1'b1; #1 btnC = 1'b0; q = 4'd0; d = 4'bx;
    for (i = 0; i < 48; i = i + 1) begin
      sw = {12'd0, 4'(i * 7 + 3)};
      if (i % 4 == 3) begin #2 btnC = 1'b1; d = q; q = 4'd0; #1 btnC = 1'b0; end
      else begin tick; d = q; q = sw[3:0]; end
      #1 if (!(led === {8'd0, d, q})) begin $display("FAIL: step %0d (led=%h want %h%h)", i, led, d, q); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
