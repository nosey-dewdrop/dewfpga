module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    unique case (sw[1:0])
      2'd0: led[3:0] = 4'h1;
      2'd1: led[3:0] = 4'h2;
      2'd2: led[3:0] = 4'h4;
      2'd3: led[3:0] = 4'h8;
    endcase
    priority casez (sw[7:4])
      4'b1???: led[5:4] = 2'd3;
      4'b01??: led[5:4] = 2'd2;
      4'b001?: led[5:4] = 2'd1;
      default: led[5:4] = 2'd0;
    endcase
    led[15:6] = '0;
  end
endmodule
