module top #(parameter bit USE_XOR = 1) (input logic [15:0] sw, output logic [15:0] led);
  genvar i;
  generate
    for (i = 0; i < 4; i = i + 1) begin : g_and
      assign led[i] = sw[i] & sw[i+4];
    end
  endgenerate
  for (genvar j = 0; j < 4; j++) begin : g_sel
    if (USE_XOR) begin : g_x
      assign led[4+j] = sw[j] ^ sw[j+4];
    end else begin : g_o
      assign led[4+j] = sw[j] | sw[j+4];
    end
  end
  localparam int MODE = 2;
  case (MODE)
    1:       begin : c1 assign led[15:8] = 8'h11;    end
    2:       begin : c2 assign led[15:8] = sw[15:8]; end
    default: begin : cd assign led[15:8] = '0;       end
  endcase
endmodule
