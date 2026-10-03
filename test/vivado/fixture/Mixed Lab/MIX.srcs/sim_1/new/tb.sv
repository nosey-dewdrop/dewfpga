module tb;
    logic [1:0] sw; logic led, clk;
    clkgen u_clk(.clk(clk));
    top dut(.sw(sw), .led(led));
    initial begin
        sw = 2'b11; #10 if (led !== 1'b1) $error("led=%b, expected 1", led);
        sw = 2'b01; #10 if (led !== 1'b0) $error("led=%b, expected 0", led);
        $display("mixed tb done");
        $finish;
    end
endmodule
