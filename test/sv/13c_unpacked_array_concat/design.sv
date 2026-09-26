module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] arr [0:1];
  assign arr = {sw[3:0], sw[7:4]};        // an unpacked array concatenation: arr[0] = sw[3:0], arr[1] = sw[7:4]
  assign led = {8'd0, arr[0], arr[1]};
endmodule
