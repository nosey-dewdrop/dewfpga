module top(input logic [15:0] sw, output logic [15:0] led);
  typedef struct packed { logic [3:0] hi; logic [3:0] lo; } byte_t;
  byte_t b, c;
  assign b = sw[7:0];
  assign c = '{hi: b.lo, lo: b.hi};        // named assignment pattern
  assign led[7:0] = c;
  assign led[15:8] = '{default: 1'b0};
endmodule
