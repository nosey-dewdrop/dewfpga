package a_pkg;                       // sorts first by name, uses z_pkg: z_pkg.sv has to be read before this file
  import z_pkg::*;
  localparam logic [3:0] K = BASE + 4'h1;
endpackage
