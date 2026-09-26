module top(input logic [15:0] sw, output logic [15:0] led);
  logic [4:0] n;
  logic f;
  always_comb begin
    int i;
    n = 0; i = 0;
    do begin n = n + sw[i]; i++; end while (i < 16);   // the condition is tested after the body
    f = 1'b0; i = 16;
    do begin f = sw[i - 1]; i++; end while (i < 16);   // false on entry: the body still runs once
  end
  assign led = {10'b0, f, n};
endmodule
