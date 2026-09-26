module tristate(input logic [3:0] a, input logic en, output tri [3:0] y);
  assign y = en ? a : 4'bz;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  tri [3:0] bus;                                           // one internal bus, two drivers taking turns
  tristate t0(.a(sw[3:0]), .en(~sw[8]), .y(bus));
  tristate t1(.a(sw[7:4]), .en(sw[8]),  .y(bus));
  assign led = {12'b0, bus};
endmodule
