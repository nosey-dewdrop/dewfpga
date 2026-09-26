// ports numbered from 1, as some lab handouts number the switches: sw[1] to sw[4]
module top(input logic [4:1] sw, output logic [4:1] led);
  assign led = ~sw;
endmodule
