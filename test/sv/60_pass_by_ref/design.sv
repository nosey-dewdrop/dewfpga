module top(input logic [15:0] sw, output logic [15:0] led);
  function automatic void inc(ref logic [3:0] x);   // pass by reference: the caller's variable changes
    x = x + 4'd1;
  endfunction
  logic [3:0] v;
  always_comb begin
    v = sw[3:0];
    inc(v);
    led = {12'd0, v};
  end
endmodule
