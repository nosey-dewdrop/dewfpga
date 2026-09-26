module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [8:0] sum;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {i[7:0], 8'h5A}; #1
      sum = sw[15:8] + 1;
      // $bits(word) = 12, $clog2(10) = 4, 4'(sum) >> 1 = sum[3:1], $bits(idx) = 4
      if (!(led === {4'd4, 1'b0, sum[3:1], 3'd4, 5'd12})) begin $display("FAIL: $bits, $clog2 or the 4'() cast (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
