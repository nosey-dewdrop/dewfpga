module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [31:0] sr;
  always_ff @(posedge clk) sr <= {sr[30:0], sw[0]};
  assign led[0] = sr[31];            // fixed 32-deep delay line
  assign led[1] = sr[sw[8:4]];       // dynamic tap
  assign led[15:2] = '0;
endmodule
