// A course "ready module": handed out in the form Vivado writes after synthesis (primitives, no RTL),
// the way the CS223 project files ship their keypad, stepper-motor and seven-segment drivers.
(* keep_hierarchy = "yes" *)
module ready_xor
   (a,
    b,
    y,
    z);
  input a;
  input b;
  output y;
  output z;

  wire \<const0> ;
  wire a;
  wire b;
  wire y;

  assign z = \<const0> ;
  GND GND
       (.G(\<const0> ));
  LUT2 #(
    .INIT(4'h6))
    y_INST_0
       (.I0(a),
        .I1(b),
        .O(y));
endmodule
