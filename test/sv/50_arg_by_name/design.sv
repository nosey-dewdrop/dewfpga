module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic logic [7:0] diff(input logic [7:0] a, input logic [7:0] b);
    diff = a - b;
  endfunction
  assign led[7:0]  = diff(.b(sw[15:8]), .a(sw[7:0]));   // arguments bound by name, in the other order
  assign led[15:8] = diff(sw[15:8], sw[7:0]);
endmodule
