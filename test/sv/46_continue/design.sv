module top(input logic [15:0] sw, output logic [15:0] led);
  logic [4:0] n;
  always_comb begin
    n = 0;
    for (int i = 0; i < 16; i++) begin
      if (!sw[i]) continue;   // skip the switches that are off
      n++;
    end
  end
  assign led = {11'b0, n};
endmodule
