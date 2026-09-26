// UG901's RAM_STYLE attribute asks for a block RAM: 256 bytes, written with btnC, read one clock later
module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  (* ram_style = "block" *) logic [7:0] mem [0:255];
  always_ff @(posedge clk) begin
    if (btnC) mem[sw[15:8]] <= sw[7:0];
    led <= {8'b0, mem[sw[15:8]]};
  end
endmodule
