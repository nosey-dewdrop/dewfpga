# 7_no_testbench

Baseline (fixture as given): sim exit 1, ERROR [no-testbench]; bit exit 0 (the design is fine).

Intended behaviour: The design is correct and must not change. The task is a testbench that fails loudly ($error on a wrong value, $finish at the end) for a registered 8+8-bit adder with carry on led[8:0].

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
