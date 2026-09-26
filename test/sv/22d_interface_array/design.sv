interface pair_if;
  logic [3:0] d;
endinterface
module top(input logic [15:0] sw, output logic [15:0] led);
  pair_if p [0:1] ();                    // an array of interfaces
  assign p[0].d = sw[3:0];
  assign p[1].d = sw[7:4];
  assign led = {8'd0, p[0].d, p[1].d};
endmodule
