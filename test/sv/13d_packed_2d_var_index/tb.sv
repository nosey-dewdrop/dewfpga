module tb;
  // iverilog cannot compile this design, so the netlist has only this testbench to catch a synthesis fault
  // (eqv.sh skips): the grid is clocked in from one value of the switches, and the row and column that
  // led[15:12] pick come from another, so every LUT input combination shows, not only grid == sw
  logic clk = 0; logic [15:0] sw = 0; logic [15:0] led;
  top dut(.clk(clk), .sw(sw), .led(led));
  integer i, bad = 0; logic [15:0] g, want;
  initial begin
    for (i = 0; i < 20000; i++) begin
      sw = (i < 256) ? {i[7:0], i[7:0]} : $random;
      #5 clk = 1; #5 clk = 0; g = sw;                // what grid holds now
      if (i >= 256) begin sw = $random; #1; end      // a new row and column, the grid unchanged
      want[11:0] = g[11:0];
      want[12] = g[4*sw[13:12] + sw[15:14]];
      want[15:13] = g[4*sw[13:12] + 1 +: 3];
      if (led !== want) begin bad++; if (bad < 4) $display("FAIL: grid=%h sw=%h led=%h want=%h", g, sw, led, want); end
    end
    if (bad == 0) $display("PASS"); else $display("FAIL: %0d of 20000", bad);
    $finish;
  end
endmodule
