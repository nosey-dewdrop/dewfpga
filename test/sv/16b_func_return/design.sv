module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic logic [3:0] maxn(input logic [3:0] a, input logic [3:0] b);
    if (a > b) return a;
    return b;
  endfunction
  assign led[3:0] = maxn(sw[3:0], sw[7:4]);
  assign led[15:4] = '0;
endmodule
