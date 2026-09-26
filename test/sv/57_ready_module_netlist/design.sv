module top(input logic [15:0] sw, output logic [15:0] led);
  ready_xor u_x (.a(sw[0]), .b(sw[1]), .y(led[0]), .z(led[1]));   // a module the course hands out in netlist form (ready.sv)
  assign led[15:2] = sw[15:2];
endmodule
