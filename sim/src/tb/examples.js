export const TB_EXAMPLES = {
  'tb: switches to leds': `// drives sw, checks led, dumps a waveform.
\`timescale 1ns/1ps
module tb;
  logic [15:0] sw, led;
  top dut(.sw(sw), .led(led));
  initial begin
    $dumpfile("wave.vcd"); $dumpvars(0, tb);
    sw = 16'h0000; #10;
    sw = 16'h00ff; #10;
    if (led !== 16'h00ff) $display("FAIL: led = %h", led); else $display("ok: led = %h", led);
    sw = 16'ha5a5; #10;
    if (led !== 16'ha5a5) $display("FAIL: led = %h", led); else $display("ok: led = %h", led);
    $finish;
  end
endmodule
`,
  'tb: blink': `// clocks the blink design and watches led0 toggle.
\`timescale 1ns/1ps
module tb;
  logic clk = 0;
  logic led0;
  top dut(.clk(clk), .led0(led0));
  always #5 clk = ~clk;          // 100 mhz
  int toggles = 0;
  logic prev = 0;
  always @(posedge clk) begin
    if (led0 !== prev) begin toggles++; $display("t=%0t led0 -> %b", $time, led0); end
    prev = led0;
  end
  initial begin
    $dumpfile("wave.vcd"); $dumpvars(0, tb);
    repeat (600) @(posedge clk);
    $display("%0d toggles in 600 cycles", toggles);
    $finish;
  end
endmodule
`,
  'tb: traffic light fsm': `// resets the fsm, releases the sensors, prints every light change.
\`timescale 1ns/1ps
module tb;
  logic clk = 0, btnU = 0;
  logic [1:0] sw = 2'b11;
  logic [5:0] led;
  top dut(.clk(clk), .btnU(btnU), .sw(sw), .led(led));
  always #5 clk = ~clk;
  always @(led) $display("t=%0t  la=%b  lb=%b", $time, led[2:0], led[5:3]);
  initial begin
    $dumpfile("wave.vcd"); $dumpvars(0, tb);
    btnU = 1; repeat (3) @(posedge clk); btnU = 0;
    sw = 2'b00;
    repeat (2000) @(posedge clk);
    $finish;
  end
endmodule
`,
};
