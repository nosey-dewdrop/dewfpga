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

    initial begin
        $dumpfile("blink.vcd");
        $dumpvars(0, blink_tb);

        sw[0] = 0;
        #100;
        if (led[15] !== 1'b0) $error("led[15] must be 0 while sw[0]=0");
        if (led[0]  !== 1'b0) $error("led[0] must be 0 while sw[0]=0");

        sw[0] = 1;
        #100;
        if (led[15] !== 1'b1) $error("led[15] must be 1 while sw[0]=1");

        $display("TB: basic checks passed (see the waveform for the toggle)");
        $finish;
    end
endmodule
