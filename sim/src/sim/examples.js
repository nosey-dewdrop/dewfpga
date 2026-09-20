// starter projects. each one is the same three files the cli works on: design, testbench, xdc.
// 'blink' is imported verbatim from templates/, so `dewfpga new blink` and the browser show one file.
import blinkSv from '../../../templates/blink.sv?raw';
import blinkTb from '../../../templates/blink_tb.sv?raw';
import blinkXdc from '../../../templates/blink.xdc?raw';

const X = (lines) => lines.map((l) => {
  const [pin, port] = l.split(' ');
  return `set_property -dict { PACKAGE_PIN ${pin} IOSTANDARD LVCMOS33 } [get_ports { ${port} }]`;
}).join('\n');
const SW = ['V17', 'V16', 'W16', 'W17', 'W15', 'V15', 'W14', 'W13', 'V2', 'T3', 'T2', 'R3', 'W2', 'U1', 'T1', 'R2'];
const LED = ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14', 'V14', 'V13', 'V3', 'W3', 'U3', 'P3', 'N3', 'P1', 'L1'];
const SEG = ['W7', 'W6', 'U8', 'V8', 'U5', 'V5', 'U7'];
const AN = ['U2', 'U4', 'V4', 'W4'];
const swx = (n, name = 'sw') => SW.slice(0, n).map((p, i) => `${p} ${name}[${i}]`);
const ledx = (n, name = 'led') => LED.slice(0, n).map((p, i) => `${p} ${name}[${i}]`);
const segx = (name = 'seg') => SEG.map((p, i) => `${p} ${name}[${i}]`);
const anx = (name = 'an') => AN.map((p, i) => `${p} ${name}[${i}]`);

export const EXAMPLES = {
  'blink (dewfpga new blink)': {
    sv: blinkSv,
    tb: blinkTb,
    xdc: blinkXdc,
  },
  'switches to leds': {
    sv: `// flip a switch, the led above it lights up.
module top(
  input  logic [15:0] sw,
  output logic [15:0] led
);
  assign led = sw;
endmodule
`,
    tb: `// drives sw, checks led, dumps a waveform.
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
    xdc: X([...swx(16), ...ledx(16)]),
  },
  'count on the display': {
    sv: `// press the center button, the number on the display goes up.
// the four digits are multiplexed like on the real board (active-low an and seg).
module top(
  input  logic       clk,
  input  logic       btnC,
  input  logic       btnU,   // reset
  output logic [6:0] seg,
  output logic [3:0] an
);
  logic [15:0] value = '0;
  logic btn_q = 0;
  always_ff @(posedge clk) begin
    btn_q <= btnC;
    if (btnU)                 value <= '0;
    else if (btnC && !btn_q)  value <= value + 1;   // rising edge of the button
  end

\`ifdef SIM
  localparam int RW = 2;
\`else
  localparam int RW = 18;   // ~380 hz refresh on the real board
\`endif
  logic [RW-1:0] refresh = '0;
  always_ff @(posedge clk) refresh <= refresh + 1;
  logic [1:0] digit;
  assign digit = refresh[RW-1:RW-2];

  logic [3:0] nibble;
  always_comb begin
    case (digit)
      2'd0: nibble = value[3:0];
      2'd1: nibble = value[7:4];
      2'd2: nibble = value[11:8];
      default: nibble = value[15:12];
    endcase
    an = ~(4'b0001 << digit);
    case (nibble)   // gfedcba, active low
      4'h0: seg = 7'b1000000; 4'h1: seg = 7'b1111001;
      4'h2: seg = 7'b0100100; 4'h3: seg = 7'b0110000;
      4'h4: seg = 7'b0011001; 4'h5: seg = 7'b0010010;
      4'h6: seg = 7'b0000010; 4'h7: seg = 7'b1111000;
      4'h8: seg = 7'b0000000; 4'h9: seg = 7'b0010000;
      4'hA: seg = 7'b0001000; 4'hB: seg = 7'b0000011;
      4'hC: seg = 7'b1000110; 4'hD: seg = 7'b0100001;
      4'hE: seg = 7'b0000110; default: seg = 7'b0001110;
    endcase
  end
endmodule
`,
    tb: `// presses the button three times and reads the counter through the hierarchy.
\`timescale 1ns/1ps
module tb;
  logic clk = 0, btnC = 0, btnU = 0;
  logic [6:0] seg;
  logic [3:0] an;
  top dut(.clk(clk), .btnC(btnC), .btnU(btnU), .seg(seg), .an(an));
  always #5 clk = ~clk;   // 100 mhz
  task press; begin btnC = 1; repeat (3) @(posedge clk); btnC = 0; repeat (3) @(posedge clk); end endtask
  initial begin
    $dumpfile("wave.vcd"); $dumpvars(0, tb);
    btnU = 1; @(posedge clk); btnU = 0; @(posedge clk);
    press; press; press;
    $display("value after 3 presses = %0d", dut.value);
    if (dut.value !== 3) $display("FAIL: expected 3");
    // digit 0 is selected when an == 4'b1110; its segments should spell 3 (0110000)
    wait (an == 4'b1110); #1;
    $display("an=%b seg=%b (%s)", an, seg, seg == 7'b0110000 ? "3, ok" : "not a 3");
    $finish;
  end
endmodule
`,
    xdc: X(['W5 clk', 'U18 btnC', 'T18 btnU', ...segx(), ...anx()]),
  },
  'traffic light fsm': {
    sv: `// the classic two-street traffic light from the textbook.
// sw0 and sw1 are the traffic sensors, leds 2..0 and 5..3 are the two lights (r y g).
module top(
  input  logic       clk,
  input  logic       btnU,          // reset
  input  logic [1:0] sw,            // ta, tb
  output logic [5:0] led
);
  typedef enum logic [1:0] {S0, S1, S2, S3} state_t;
  state_t state = S0, next;

\`ifdef SIM
  localparam int W = 8;    // a state lasts 256 simulated cycles
\`else
  localparam int W = 26;
\`endif
  logic [W-1:0] slow = '0;
  always_ff @(posedge clk) slow <= slow + 1;
  logic tick;
  assign tick = (slow == '0);

  always_ff @(posedge clk)
    if (btnU) state <= S0;
    else if (tick) state <= next;

  always_comb
    case (state)
      S0: if (sw[0]) next = S0; else next = S1;
      S1: next = S2;
      S2: if (sw[1]) next = S2; else next = S3;
      default: next = S0;
    endcase

  // la = led[2:0], lb = led[5:3]  (bit 2 = red, 1 = yellow, 0 = green)
  always_comb
    case (state)
      S0: led = {3'b100, 3'b001};
      S1: led = {3'b100, 3'b010};
      S2: led = {3'b001, 3'b100};
      default: led = {3'b010, 3'b100};
    endcase
endmodule
`,
    tb: `// resets the fsm, releases the sensors, prints every light change.
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
    xdc: X(['W5 clk', 'T18 btnU', ...swx(2), ...ledx(6)]),
  },
};
export const DEFAULT_EXAMPLE = 'blink (dewfpga new blink)';
