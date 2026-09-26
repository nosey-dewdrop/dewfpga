module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic logic [4:0] popcount(input logic [15:0] v);
    popcount = '0;
    for (int i = 0; i < 16; i = i + 1) popcount = popcount + v[i];
  endfunction
  function logic [3:0] rev4(input logic [3:0] v);
    rev4 = {v[0], v[1], v[2], v[3]};
  endfunction
  task automatic invert(input logic [3:0] a, output logic [3:0] y);
    y = ~a;
  endtask
  always_comb begin
    led[4:0] = popcount(sw);
    led[8:5] = rev4(sw[3:0]);
    invert(sw[7:4], led[12:9]);
    led[15:13] = '0;
  end
endmodule
