(* keep_hierarchy = "yes" *) module inv(input logic a, output logic y);   // UG901 p.60, spaced as there
  assign y = ~a;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  inv u0 (.a(sw[0]), .y(led[0]));
  assign led[15:1] = sw[15:1];
endmodule
