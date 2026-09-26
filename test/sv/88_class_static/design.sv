class util;                              // a class used only for its static function; no object is made
  static function logic [3:0] rev(logic [3:0] a);
    rev = {a[0], a[1], a[2], a[3]};
  endfunction
endclass
module top(input logic [15:0] sw, output logic [15:0] led);
  assign led = {sw[15:4], util::rev(sw[3:0])};
endmodule
