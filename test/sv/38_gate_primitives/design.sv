module top(input logic [15:0] sw, output logic [15:0] led);
  logic ns, t0, t1;                     // logic variables driven by gate primitives (CS223 structural labs)
  not g0 (ns, sw[2]);
  and g1 (t0, sw[0], ns);
  and g2 (t1, sw[1], sw[2]);
  or  g3 (led[0], t0, t1);              // an output logic port driven by a primitive: a 2-to-1 mux
  xor g4 (led[1], sw[3], sw[4], sw[5]);
  assign led[15:2] = '0;
endmodule
