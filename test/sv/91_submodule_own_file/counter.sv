module counter(input logic clk, input logic rst, output logic [3:0] q);
  always_ff @(posedge clk) if (rst) q <= '0; else q <= q + 4'd1;
endmodule
