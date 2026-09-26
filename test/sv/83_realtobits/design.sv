module top(input logic [15:0] sw, output logic [15:0] led);
  localparam logic [63:0] B = $realtobits(2.5);                 // IEEE 754: 64'h4004_0000_0000_0000
  localparam real         R = $bitstoreal(64'h3FF8_0000_0000_0000);   // 1.5
  assign led = sw ^ B[63:48] ^ 16'($rtoi(R * 4.0));             // sw ^ 16'h4004 ^ 16'd6
endmodule
