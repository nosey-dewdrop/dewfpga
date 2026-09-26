module top(input logic [15:0] sw, output logic [15:0] led);
  (* keep = "true" *)       logic mid;
  (* dont_touch = "true" *) logic mid2;
  assign mid  = sw[0] & sw[1];
  assign mid2 = sw[2] | sw[3];
  assign led[0] = mid | sw[2];
  assign led[1] = mid2 ^ sw[4];
  assign led[15:2] = '0;
endmodule
