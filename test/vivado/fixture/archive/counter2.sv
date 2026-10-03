module counter2(input logic clk, input logic en, output logic [1:0] q);
    initial q = '0;
    always_ff @(posedge clk) if (en) q <= q + 2'd1;
endmodule
