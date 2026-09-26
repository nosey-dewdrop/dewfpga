module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [15:0] cnt;
  counter u_c (.clk(clk), .btnC(btnC), .led(cnt));
  assign led = sw[15] ? sw : cnt;
  // a check for the simulation; synthesis ignores $finish (UG901 Table 21)
  always @(posedge clk) if (cnt == 16'hFFFF) begin $display("ERROR: the counter wrapped"); $finish; end
endmodule
