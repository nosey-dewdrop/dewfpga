interface sum_if;
  logic [3:0] a, b;
  logic [4:0] s;
  modport prod (output a, b, input s);
  modport cons (input a, b, output s);
endinterface
module producer(sum_if.prod bus, input logic [7:0] in, output logic [4:0] res);
  assign bus.a = in[3:0];
  assign bus.b = in[7:4];
  assign res = bus.s;
endmodule
module consumer(sum_if.cons bus);
  assign bus.s = bus.a + bus.b;
endmodule
module top(input logic [15:0] sw, output logic [15:0] led);
  sum_if bus();
  producer u_p (.bus(bus), .in(sw[7:0]), .res(led[4:0]));
  consumer u_c (.bus(bus));
  assign led[15:5] = '0;
endmodule
