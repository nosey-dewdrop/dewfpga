module top(input logic [15:0] sw, output logic [15:0] led);
  wor  [3:0] any;                      // a wired-OR net: its two drivers are ORed
  wand [3:0] both;                     // a wired-AND net: ANDed
  assign any  = sw[3:0];
  assign any  = sw[7:4];
  assign both = sw[3:0];
  assign both = sw[7:4];
  assign led = {8'd0, both, any};
endmodule
