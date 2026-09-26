package p1;
  localparam logic [3:0] K = 4'd9;
endpackage
package p2;
  import p1::K;
  export p1::K;                          // p2 hands on the K it imported from p1
endpackage
module top(input logic [15:0] sw, output logic [15:0] led);
  import p2::*;
  assign led = {sw[15:4], sw[3:0] ^ K};  // K reached through p2
endmodule
