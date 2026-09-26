module top(input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] k; logic f;
  always_comb begin
    k = 0; f = 0;
    for (int i = 0; i < 16; i++)
      if (sw[i]) begin k = i; f = 1; break; end   // stop at the lowest set switch
  end
  assign led = {11'b0, f, k};
endmodule
