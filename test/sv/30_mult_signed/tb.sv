module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg;
  integer i, a, b, p, sh;
  top dut(.sw(sw), .led(led), .seg(seg));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      // the reference in plain integers: two's complement by hand, >>> 4 as a floor division by 16
      a = sw[7:0];  if (sw[7])  a = a - 256;
      b = sw[15:8]; if (sw[15]) b = b - 256;
      p = a * b;
      sh = (a >= 0) ? a / 16 : -((15 - a) / 16);
      if (!(led === p[15:0])) begin $display("FAIL: %0d * %0d (sw=%h led=%h)", a, b, sw, led); $finish; end
      if (!(seg === {sh < 0, sw[3] == 1'b1, sh[3:0], a < b})) begin
        $display("FAIL: >>>, $signed or signed < (sw=%h seg=%b, want sh=%0d a<b=%0d)", sw, seg, sh, a < b); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
