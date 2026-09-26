module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    led = '0;
    unique0 if (sw[1:0] == 2'b01) led[0] = 1'b1;     // unique0: no branch may match, and then nothing is done
    else if (sw[1:0] == 2'b10) led[1] = 1'b1;
  end
endmodule
