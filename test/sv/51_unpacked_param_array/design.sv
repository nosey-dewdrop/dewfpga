module top(input logic [15:0] sw, output logic [15:0] led);
  localparam logic [6:0] SEGS [0:3] = '{7'h40, 7'h79, 7'h24, 7'h30};   // an unpacked array constant, 0 to 3 on a 7-segment digit
  assign led = {9'b0, SEGS[sw[1:0]]};
endmodule
