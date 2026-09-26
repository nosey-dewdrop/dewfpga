module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] q = '0;
  always_ff @(posedge clk) q <= q + sw[3:0];
  assign led = {12'd0, q};
  integer fd;                                  // a debug trace left in the design
  initial fd = $fopen("trace.txt");
  always @(posedge clk) begin
    $fdisplay(fd, "q=%h", q);
    $fwrite(fd, "sw=%h\n", sw);
  end
endmodule
