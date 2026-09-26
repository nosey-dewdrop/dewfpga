module producer(sum_if bus, input logic [7:0] in, output logic [4:0] res);   // sum_if lives in sum_if.sv
  assign bus.a = in[3:0];
  assign bus.b = in[7:4];
  assign res = bus.s;
endmodule
module consumer(sum_if bus);
  assign bus.s = bus.a + bus.b;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  sum_if bus();
  producer u_p (.bus(bus), .in(sw[7:0]), .res(led[4:0]));
  consumer u_c (.bus(bus));
  assign led[15:5] = '0;
endmodule
