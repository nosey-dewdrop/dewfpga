module constsel(input logic [3:0] r, output logic y);
  always_comb begin
    y = r[1:0] == 2'b11 || r[2];
  end
endmodule
