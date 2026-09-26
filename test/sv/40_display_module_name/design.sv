module display(input logic [3:0] x, output logic [6:0] seg);   // a natural name for a 7-segment module
  assign seg = {x[0], x[1], x[2], x[3], ^x, &x, |x};
endmodule
module top(input logic [15:0] sw, output logic [15:0] led, output logic [6:0] seg);
  display u_disp (.x(sw[3:0]), .seg(seg));
  assign led = sw;
  initial $display("top: display loaded");   // a debug print in the design, next to a module named display
endmodule
