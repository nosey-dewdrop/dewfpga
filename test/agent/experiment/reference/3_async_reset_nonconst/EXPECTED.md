# 3_async_reset_nonconst

Baseline (fixture as given): sim exit 0 (iverilog simulates the async load); bit exit 1, ERROR [async-reset-nonconst], no .bit.

Intended behaviour: 4-bit counter on led[3:0]: while btnC is held the next clock loads sw[3:0], otherwise it counts up by one per clock. A synchronous load is the fix; the testbench only looks after a clock edge, so it accepts both.

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
