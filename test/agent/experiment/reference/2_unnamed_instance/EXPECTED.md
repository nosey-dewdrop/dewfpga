# 2_unnamed_instance

Baseline (fixture as given): sim exit 0 (iverilog accepts the unnamed instance); bit exit 0 with note [unnamed-instance] (the CLI names it in the file). Control.

Intended behaviour: led[0] = ~sw[0]; led[15:1] = sw[15:1].

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
