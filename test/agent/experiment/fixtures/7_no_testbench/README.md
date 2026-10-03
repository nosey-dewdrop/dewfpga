# top: registered adder

`top.sv` adds `sw[7:0]` and `sw[15:8]` on every rising edge of `clk` and shows the 9-bit sum, carry included,
on `led[8:0]` (`led[15:9]` stay 0). The design is believed correct; it has no testbench, so `dewfpga sim` refuses to run.
Needed: `tb.sv`, a module without ports that instantiates `top`, drives `clk` and `sw`, checks `led` after a clock
with `$error` on a wrong value (at least: a small sum, a sum with carry, and that `led` does not change before the clock),
and ends with `$finish`.
