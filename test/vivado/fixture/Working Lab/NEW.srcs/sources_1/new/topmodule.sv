module topmodule(input logic clk, input logic [1:0] sw, output logic [1:0] led);
    logic [1:0] q;
    counter2 u_cnt(.clk(clk), .en(sw[0]), .q(q));
    assign led = q ^ {2{sw[1]}};
endmodule
