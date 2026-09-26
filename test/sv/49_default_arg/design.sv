module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic logic [7:0] addk(input logic [7:0] a, input logic [7:0] k = 8'd3);
    addk = a + k;
  endfunction
  assign led[7:0]  = addk(sw[7:0]);           // k left out: its default, 3
  assign led[15:8] = addk(sw[15:8], 8'd5);
endmodule
