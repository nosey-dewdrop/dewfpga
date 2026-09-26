module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      if (led !== {8'd0, 8'(sw[7:0] + sw[15:8])}) begin $display("FAIL: sw=%h led=%h", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
