module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [13:0] value;
  logic [3:0] d0, d1, d2, d3;
  always_ff @(posedge clk)
    if (btnC) value <= sw[13:0];              // load a number with the center button
  always_ff @(posedge clk) begin            // its four decimal digits, registered: a long divide chain
    d0 <= value % 10;
    d1 <= (value / 10) % 10;
    d2 <= (value / 100) % 10;
    d3 <= value / 1000;
  end
  assign led = {d3, d2, d1, d0};
endmodule
