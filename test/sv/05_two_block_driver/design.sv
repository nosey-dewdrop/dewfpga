module top(input logic btnU, input logic btnC, output logic [15:0] led);
  logic [3:0] cnt = 4'd0;
  always @(posedge btnU) cnt <= cnt + 4'd1;   // written on one edge
  always @(posedge btnC) cnt <= 4'd0;         // and on another
  assign led = {12'd0, cnt};
endmodule
