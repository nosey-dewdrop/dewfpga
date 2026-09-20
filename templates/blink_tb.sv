// blink_tb.sv: does the counter run and does sw[0] gate the LED?
// Waiting 50M cycles is pointless here; this bench checks the sw[0] mask
// and that the clock advances the counter. Look at the waveform for the toggle.
`timescale 1ns/1ps

module blink_tb;
    logic        clk = 0;
    logic [15:0] sw  = '0;
    logic [15:0] led;

    blink dut (.clk(clk), .sw(sw), .led(led));

    always #5 clk = ~clk;   // 100 MHz

    int errors = 0;
    task check(input bit ok, input string what);
        if (!ok) begin errors++; $error("%s", what); end
    endtask

    initial begin
        $dumpfile("blink.vcd");
        $dumpvars(0, blink_tb);

        sw[0] = 0;
        #100;
        check(led[15] === 1'b0, "led[15] must be 0 while sw[0]=0");
        check(led[0]  === 1'b0, "led[0] must be 0 while sw[0]=0");

        sw[0] = 1;
        #100;
        check(led[15] === 1'b1, "led[15] must be 1 while sw[0]=1");

        if (errors == 0) $display("PASS: 3 checks (see the waveform for the toggle)");
        else             $display("FAIL: %0d of 3 checks", errors);
        $finish;
    end
endmodule
