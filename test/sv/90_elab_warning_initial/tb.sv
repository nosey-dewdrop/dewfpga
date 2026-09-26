module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      if (led !== (sw & 16'h000f)) begin $display("FAIL: sw=%h led=%h, want %h", sw, led, sw & 16'h000f); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
