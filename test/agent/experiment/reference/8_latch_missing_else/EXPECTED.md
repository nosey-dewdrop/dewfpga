# 8_latch_missing_else

Baseline (fixture as given): sim exit 1 (the latch holds 1 where 0 is wanted); bit exit 0 with warning [latch] (builds like Vivado, as an LDCE).

Intended behaviour: Combinational: led[0] = sw[1] ? sw[0] : 0. No storage.

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
