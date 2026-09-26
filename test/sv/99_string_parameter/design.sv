// a ROM module that takes its $readmemh file as a string parameter
module rom #(parameter string INIT_FILE = "digits.mem") (input logic [3:0] a, output logic [7:0] q);
  logic [7:0] m [0:15];
  initial $readmemh(INIT_FILE, m);
  assign q = m[a];
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  rom u(.a(sw[3:0]), .q(led[7:0]));
  assign led[15:8] = '0;
endmodule
