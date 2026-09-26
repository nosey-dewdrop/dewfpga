module tb;
  logic [15:0] sw; logic [6:0] seg; logic [3:0] an;
  top dut(.sw(sw), .seg(seg), .an(an));
  logic [6:0] want [0:3] = '{7'b1000000, 7'b1111001, 7'b0100100, 7'b0110000};   // 0, 1, 2, 3
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 64; i++) begin
      sw = i; #1;
      if (seg !== want[sw[1:0]] || an !== 4'b1110) begin bad++; if (bad < 4) $display("FAIL: sw=%h seg=%b", sw, seg); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 64", bad);
    $finish;
  end
endmodule
