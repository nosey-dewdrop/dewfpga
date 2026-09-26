module top(input logic [15:0] sw, output logic [15:0] led);
  typedef logic [3:0] quad_t [0:3];
  function automatic logic [5:0] sum4(input quad_t q);   // an unpacked array as a function argument
    sum4 = q[0] + q[1] + q[2] + q[3];
  endfunction
  quad_t v;
  always_comb begin
    for (int i = 0; i < 4; i++) v[i] = sw[4*i +: 4];
    led = {10'd0, sum4(v)};
  end
endmodule
