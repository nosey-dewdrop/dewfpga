module syntax_tb;
  logic clk = 0, q;
  syntax dut(.clk(clk), .q(q));
  initial begin #10 $finish; end
endmodule
