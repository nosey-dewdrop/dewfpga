# 1_port_direction

Baseline (fixture as given): sim exit 0; bit exit 0 with note [port-neither-input-nor-output] (the CLI writes 'output' into the file). Control: nothing to repair.

Intended behaviour: sw[6:0] inverted on seg, sw[7] on dp, sw[11:8] inverted on an. The only defect is the port line; the CLI already fixes it.

`top.sv` here is one correct repair (the reference the netlist is compared with); `tb.sv` is the independent acceptance testbench, run against the agent's design in place of the agent's own.
