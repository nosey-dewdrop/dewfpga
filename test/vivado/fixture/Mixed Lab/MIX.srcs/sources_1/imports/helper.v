module helper(input wire [1:0] a, output wire y);
    wire bit; wire final;
    assign bit = a[0]; assign final = a[1];
    assign y = bit & final;
endmodule
