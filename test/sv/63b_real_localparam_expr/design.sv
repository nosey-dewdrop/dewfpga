module top(input logic clk, input logic btnC, output logic [15:0] led);
  localparam MAX = 1e1;                   // a real literal, 10 (a lab writes 50e6 for one second)
  logic [3:0] count = '0;
  logic blink = 1'b0;
  always_ff @(posedge clk)
    if (btnC) begin count <= 0; blink <= 0; end
    else if (count == MAX - 1) begin count <= 0; blink <= ~blink; end
    else count <= count + 1;
  assign led = {15'd0, blink};
endmodule
