module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [3:0] div = '0;                   // a clock divider (a lab divides by 2^26; the width does not change the timing check)
  logic slow = 1'b0;
  always_ff @(posedge clk) begin div <= div + 4'd1; if (div == 4'd0) slow <= ~slow; end
  logic [13:0] value = '0;
  logic [3:0] d0 = '0, d1 = '0, d2 = '0, d3 = '0;
  always_ff @(posedge slow) if (btnC) value <= sw[13:0];
  always_ff @(posedge slow) begin         // the number's four decimal digits, on the slow clock
    d0 <= value % 10; d1 <= (value / 10) % 10; d2 <= (value / 100) % 10; d3 <= value / 1000;
  end
  assign led = {d3, d2, d1, d0};
endmodule
