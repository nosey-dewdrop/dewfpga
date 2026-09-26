module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 64; i = i + 1) begin
      sw = {10'h2c5, i[5:0]}; #1
      if (!(led === {10'd0, 6'(sw[5:0] + 6'd3)})) begin $display("FAIL: b is 6 bits wide (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
