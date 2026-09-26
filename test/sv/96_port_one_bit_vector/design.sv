// a module written for any width, used at width 1: its ports are [0:0], one bit numbered 0 (sw[0], led[0])
module top #(parameter int N = 1) (input logic [N-1:0] sw, output logic [N-1:0] led);
  assign led = ~sw;
endmodule
