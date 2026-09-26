module top(input logic [15:0] sw, output logic [15:0] led);
  typedef struct packed { logic [3:0] hi; logic [3:0] lo; } byte_t;
  typedef struct packed { logic valid; byte_t data; } pkt_t;
  byte_t b;
  pkt_t p;
  assign b = sw[7:0];
  always_comb begin
    p.valid   = sw[8];
    p.data.hi = b.lo;
    p.data.lo = b.hi;
  end
  assign led[8:0] = p;
  assign led[15:9] = '0;
endmodule
