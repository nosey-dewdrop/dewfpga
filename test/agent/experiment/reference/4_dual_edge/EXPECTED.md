# 4_dual_edge

Baseline (fixture as given): sim exit 1 (the testbench wants 3 after 3 periods, the dual-edge counter shows 6); bit exit 1, ERROR [dual-edge].

Intended behaviour: 4-bit counter on led[3:0], one count per clock period (rising edge).

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
