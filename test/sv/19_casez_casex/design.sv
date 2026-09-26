module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    casez (sw[3:0])
      4'b1???: led[1:0] = 2'd3;
      4'b01??: led[1:0] = 2'd2;
      4'b001?: led[1:0] = 2'd1;
      default: led[1:0] = 2'd0;
    endcase
    casex (sw[7:4])
      4'b1xx0: led[2] = 1'b1;
      default: led[2] = 1'b0;
    endcase
    led[15:3] = '0;
  end
endmodule
