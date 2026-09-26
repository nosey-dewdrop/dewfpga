module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i, k; reg [15:0] want;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      want = 16'd16;
      for (k = 15; k >= 0; k = k - 1) if (sw[k]) want = k;
      if (!(led === want)) begin $display("FAIL: index of the lowest switch up (sw=%h led=%h want %h)", sw, led, want); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
