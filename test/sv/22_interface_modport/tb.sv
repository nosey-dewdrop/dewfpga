module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {8'hA5, i[7:0]}; #1
      if (!(led === {11'd0, 5'(sw[3:0] + sw[7:4])})) begin $display("FAIL: a + b through the interface (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
