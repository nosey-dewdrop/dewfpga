module top(input logic clk, input logic btnU, output logic [15:0] led);
  logic [3:0] cnt = 4'd0;
  always_ff @(posedge clk or posedge btnU)   // button used as a second 'clock'
    if (btnU) cnt <= cnt + 4'd1;              // async branch depends on cnt itself
    else      cnt <= cnt;
  assign led = {12'd0, cnt};
endmodule
