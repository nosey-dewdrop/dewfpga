module top(input logic [15:0] sw, output logic [15:0] led);
  localparam real STEP = 2.6;           // a real parameter
  localparam int INC = int'(STEP);      // cast to int: rounds to 3
  assign led = sw + INC;
endmodule
