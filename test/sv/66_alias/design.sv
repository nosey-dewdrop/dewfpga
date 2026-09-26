module top(input logic [15:0] sw, output logic [15:0] led);
  wire [3:0] a, b;
  alias a = b;                         // a and b are one net
  assign a = sw[3:0];
  assign led = {12'd0, b};
endmodule
