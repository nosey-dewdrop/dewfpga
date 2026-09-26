module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      if (!(led === {10'd0, 6'(sw[3:0] + sw[7:4] + sw[11:8] + sw[15:12])})) begin $display("FAIL: sum4 of the four nibbles (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
