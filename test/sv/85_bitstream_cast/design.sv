module top(input logic [15:0] sw, output logic [15:0] led);
  typedef logic [3:0] quad_t [0:1];      // an unpacked array of two nibbles
  quad_t q;
  assign q = quad_t'(sw[7:0]);           // a bitstream cast: q[0] gets sw[7:4], q[1] gets sw[3:0]
  assign led = {sw[15:8], q[1], q[0]};
endmodule
