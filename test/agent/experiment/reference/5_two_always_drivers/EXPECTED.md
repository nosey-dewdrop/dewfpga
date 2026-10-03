# 5_two_always_drivers

Baseline (fixture as given): sim: iverilog runs it (last block wins per time step, so the clear-wins check may pass by accident); bit exit 1, ERROR [two-always-drivers].

Intended behaviour: cnt counts rising edges of btnU (one count per press, synchronous edge detect), btnC clears it on the next clock and has priority over a press.

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
