module sum4(input logic [3:0] v [0:3], output logic [5:0] s);   // an unpacked array as a port
  assign s = v[0] + v[1] + v[2] + v[3];
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] v [0:3];
  assign v[0] = sw[3:0]; assign v[1] = sw[7:4]; assign v[2] = sw[11:8]; assign v[3] = sw[15:12];
  sum4 u_sum (.v(v), .s(led[5:0]));
  assign led[15:6] = '0;
endmodule
