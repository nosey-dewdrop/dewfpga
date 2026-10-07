module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb
    unique casez (sw[3:0])
      4'b10??: led = 16'd1;
      4'b??11: led = 16'd2;
      default: led = 16'd0;
    endcase
endmodule
