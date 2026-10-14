// a student's own small project, no lab names: a package holds the step, a parameterised submodule counts by it with
// a synchronous reset and an enable, the top wires it to the board. the bench checks the step the student ends with
// (5, after the browser journey edits the package) with literal numbers, not the design's own constants.
// `.Xil/` holds what vivado leaves behind: a stale copy of the top that would collide if it were imported.
const pin = (p, port) => `set_property -dict { PACKAGE_PIN ${p} IOSTANDARD LVCMOS33 } [get_ports {${port}}]`;
export const LED = ['U16', 'E19', 'U19', 'V19', 'W18', 'U15', 'U14', 'V14'];
export const pkg = (step) => `package stepper_pkg;
  localparam logic [7:0] STEP = 8'd${step};
endpackage
`;
export const ownProject = [
  { path: 'pkg/stepper_pkg.sv', text: pkg(3) },
  { path: 'rtl/accum.sv', text: `module accum #(parameter int W = 8, parameter logic [W-1:0] STEP = 1) (
  input  logic clk, rst, en,
  output logic [W-1:0] q
);
  always_ff @(posedge clk)
    if (rst)     q <= '0;
    else if (en) q <= q + STEP;
endmodule
` },
  { path: 'rtl/stepper_top.sv', text: `module stepper_top import stepper_pkg::*; (
  input  logic clk,
  input  logic [1:0] sw,
  output logic [7:0] led
);
  accum #(.W(8), .STEP(STEP)) u_acc (.clk(clk), .rst(sw[0]), .en(sw[1]), .q(led));
endmodule
` },
  { path: 'sim/stepper_tb.sv', text: `\`timescale 1ns/1ps
module stepper_tb;
  logic clk = 0, rst = 1, en = 0;
  logic [7:0] led;
  int i;
  stepper_top dut (.clk(clk), .sw({en, rst}), .led(led));
  always #5 clk = ~clk;
  initial begin
    repeat (2) @(posedge clk); #1;
    if (led !== 8'd0) $fatal(1, "reset: led=%0d", led);
    rst = 0; en = 1;
    for (i = 1; i <= 60; i++) begin
      @(posedge clk); #1;
      if (led !== 8'((i * 5) % 256)) $fatal(1, "step %0d: led=%0d", i, led);
    end
    en = 0;
    repeat (5) @(posedge clk); #1;
    if (led !== 8'd44) $fatal(1, "hold: led=%0d", led);
    rst = 1; @(posedge clk); #1;
    if (led !== 8'd0) $fatal(1, "sync reset: led=%0d", led);
    $display("PASS own stepper: reset, 60 enabled steps of 5 with wrap, hold with enable off");
    $finish;
  end
endmodule
` },
  { path: 'constraints/board.xdc', text: [pin('W5', 'clk'), 'create_clock -add -name sys_clk_pin -period 10.00 -waveform {0 5} [get_ports clk]',
    pin('V17', 'sw[0]'), pin('V16', 'sw[1]'), ...LED.map((p, i) => pin(p, `led[${i}]`))].join('\n') + '\n' },
  { path: '.Xil/stepper_top.sv', text: 'module stepper_top(input clk, output [7:0] led); assign led = 8\'hff; endmodule\n' },
];
