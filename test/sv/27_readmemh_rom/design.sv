module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] rom [0:15];
  initial $readmemh("rom.mem", rom);
  logic [7:0] rom_q;
  assign led[7:0] = rom[sw[3:0]];              // async read
  always_ff @(posedge clk) rom_q <= rom[sw[7:4]];   // sync read
  assign led[15:8] = rom_q;
endmodule
