module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0][3:0] p;              // packed 2-D
  logic [3:0] u [0:3];             // unpacked
  logic [1:0] m [0:1][0:1];        // unpacked 2-D
  assign p = sw;
  always_comb begin
    for (int i = 0; i < 4; i++) u[i] = p[i] ^ 4'hF;
    m[0][0] = sw[1:0]; m[0][1] = sw[3:2]; m[1][0] = sw[5:4]; m[1][1] = sw[7:6];
  end
  assign led[3:0] = p[2];
  assign led[7:4] = u[sw[13:12]];
  assign led[9:8] = m[sw[14]][sw[15]];
  assign led[15:10] = '0;
endmodule
