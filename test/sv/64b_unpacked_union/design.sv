typedef union { logic [7:0] byte_v; logic [3:0] nib; } view_t;   // an unpacked union (no 'packed')
module top(input logic [15:0] sw, output logic [15:0] led);
  view_t u;
  always_comb begin
    u.byte_v = sw[7:0];
    led = {8'd0, ~u.byte_v};
  end
endmodule
