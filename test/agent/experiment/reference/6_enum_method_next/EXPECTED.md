# 6_enum_method_next

Baseline (fixture as given): sim exit 0 (iverilog implements the enum methods); bit exit 1, ERROR [enum-method-next-prev].

Intended behaviour: 3-state FSM IDLE(0) -> RUN(1) -> DONE(3) -> IDLE, btnC returns to IDLE; led[1:0] = state code, led[2] = in DONE.

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
