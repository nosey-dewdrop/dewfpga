module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 8; i = i + 1) begin
      sw = {5'h15, i[2:0], 8'h5A}; #1
      // unique if: led[0] = sw[8]; priority if: sw[9] first, then sw[10], else 1
      if (!(led === {14'd0, sw[9] | ~sw[10], sw[8]})) begin $display("FAIL: unique if / priority if (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
