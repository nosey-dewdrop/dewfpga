module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    led[0] = sw[3:0] inside {4'd1, 4'd3, [4'd8:4'd10]};
    case (sw[7:4]) inside
      4'd0, 4'd1:  led[2:1] = 2'd1;
      [4'd2:4'd7]: led[2:1] = 2'd2;
      default:     led[2:1] = 2'd3;
    endcase
    led[15:3] = '0;
  end
endmodule
