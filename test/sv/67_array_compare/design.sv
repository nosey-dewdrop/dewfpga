module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a [0:1], b [0:1];
  always_comb begin
    a[0] = sw[3:0]; a[1] = sw[7:4]; b[0] = sw[11:8]; b[1] = sw[15:12];
    led = {14'd0, a != b, a == b};    // equality of two whole unpacked arrays
  end
endmodule
