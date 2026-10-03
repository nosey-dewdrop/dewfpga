module syntax(input logic clk, output logic q);
  always_ff @(posedge clk) q <= ~q
endmodule
