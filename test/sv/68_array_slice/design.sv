module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] a [0:3], b [0:1];
  always_comb begin
    for (int i = 0; i < 4; i++) a[i] = sw[4*i +: 4];
    b = a[2:3];                          // a slice of an unpacked array
    led = {8'd0, b[1], b[0]};
  end
endmodule
