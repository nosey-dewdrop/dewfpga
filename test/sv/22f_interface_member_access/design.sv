interface add_if;                         // no ports: a bundle that also adds
  logic [7:0] a, b, s;
  assign s = a + b;
endinterface
module top(input logic [15:0] sw, output logic [15:0] led);
  add_if bus ();
  assign bus.a = sw[7:0];                 // its members, from the module that instantiates it
  assign bus.b = sw[15:8];
  assign led = {8'd0, bus.s};
endmodule
