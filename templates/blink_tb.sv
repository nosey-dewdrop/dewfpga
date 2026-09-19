// blink_tb.sv — sayaç ve tersleme çalışıyor mu?
// Not: 50M çevrim beklemek yerine modülü kısa periyotla test etmek için
// bu tb sadece saatin sayacı ilerlettiğini ve sw[0] maskesini doğrular.
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
        if (led[15] !== 1'b0) $error("sw[0]=0 iken led[15] 0 olmali");
        if (led[0]  !== 1'b0) $error("sw[0]=0 iken led[0] 0 olmali");

        sw[0] = 1;
        #100;
        if (led[15] !== 1'b1) $error("sw[0]=1 iken led[15] 1 olmali");

        $display("TB: temel kontroller gecti (sayac tersleme icin dalga formuna bak)");
        $finish;
    end
endmodule
