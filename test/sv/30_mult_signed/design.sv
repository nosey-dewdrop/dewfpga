module top(input logic [15:0] sw, output logic [15:0] led, output logic [6:0] seg);
  logic signed [7:0] a, b;
  logic signed [15:0] p;
  logic signed [7:0] sh;
  assign a = sw[7:0];
  assign b = sw[15:8];
  assign p = a * b;
  assign sh = a >>> 4;
  assign led = p;
  assign seg[0] = (a < b);
  assign seg[4:1] = sh[3:0];
  assign seg[5] = ($signed(sw[3:0]) < 0);
  assign seg[6] = sh[7];                     // the sign that >>> copies in (>> would shift in 0)
endmodule
