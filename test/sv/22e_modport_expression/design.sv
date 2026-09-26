interface bus_if;
  logic [7:0] data;
  modport lo (input .nib(data[3:0]));   // a modport expression: nib is the low half of data
endinterface
module use_lo(bus_if.lo b, output logic [3:0] y);
  assign y = ~b.nib;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  bus_if bus();
  assign bus.data = sw[7:0];
  use_lo u_lo (.b(bus), .y(led[3:0]));
  assign led[15:4] = '0;
endmodule
