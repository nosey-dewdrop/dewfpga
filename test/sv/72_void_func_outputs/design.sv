module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic void split(input logic [7:0] x, output logic [3:0] hi, output logic [3:0] lo);
    hi = x[7:4];
    lo = x[3:0];
  endfunction
  logic [3:0] h, l;
  always_comb begin
    split(sw[7:0], h, l);              // a void function that returns through output arguments
    led = {8'd0, l, h};
  end
endmodule
