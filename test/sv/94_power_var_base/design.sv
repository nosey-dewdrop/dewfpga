// the square of the switches: a variable raised to a constant power
module top(input logic [15:0] sw, output logic [15:0] led);
  assign led = sw[7:0] ** 2;
endmodule
