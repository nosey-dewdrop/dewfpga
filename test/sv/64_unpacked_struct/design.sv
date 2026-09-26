module top(input logic [15:0] sw, output logic [15:0] led);
  typedef struct { logic [3:0] a; logic [3:0] b; } pair_t;   // an unpacked struct (no 'packed')
  pair_t p;
  always_comb begin
    p.a = sw[3:0];
    p.b = sw[7:4];
    led = {8'd0, p.a, p.b};
  end
endmodule
