module top(input logic [15:0] sw, output logic [15:0] led);
  parameter P = 4;
  always @(sw) begin : find_first_zero        // UG901's while-loop example, as printed there
    integer i; reg found;
    led = '0; i = 0; found = 0;
    while (!found && (i < P)) begin
      found = !sw[i];
      led[i] = !sw[i];
      i = i + 1;
    end
  end
endmodule
