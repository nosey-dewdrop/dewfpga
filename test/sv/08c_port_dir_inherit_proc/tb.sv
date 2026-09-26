module tb;
  logic [15:0] sw; logic [6:0] seg; logic [3:0] an;
  top dut(.sw(sw), .seg(seg), .an(an));
  integer i, bad = 0;
  initial begin
    for (i = 0; i < 1024; i++) begin
      sw = i; #1;
      if (an !== ~(4'b0001 << sw[9:8]) || seg !== ~sw[6:0]) begin bad++; if (bad < 4) $display("FAIL: sw=%h an=%b seg=%b", sw, an, seg); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 1024", bad);
    $finish;
  end
endmodule
