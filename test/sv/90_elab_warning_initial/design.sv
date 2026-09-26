module top #(parameter int N = 4) (input logic [15:0] sw, output logic [15:0] led);
  initial if (N < 8) $warning("top: N = %0d, only the low switches are used", N);   // a parameter check
  assign led = sw & 16'((1 << N) - 1);
endmodule
