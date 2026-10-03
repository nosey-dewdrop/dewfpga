module counter2(input logic clk, input logic en, output logic [1:0] q);
    // the disabled duplicate: Vivado keeps it in the list with AutoDisabled=1
    always_ff @(posedge clk) q <= 2'b11;
endmodule
