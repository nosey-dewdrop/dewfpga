module tb;
    logic clk = 0, en;
    logic [1:0] sw, led;
    topmodule dut(.clk(clk), .sw(sw), .led(led));
    always #5 clk = ~clk;
    initial begin
        sw = 2'b01;
        repeat (3) @(posedge clk);
        #1 if (led !== 2'd3) $error("led=%b, expected 11", led);
        $display("tb done");
        $finish;
    end
endmodule
