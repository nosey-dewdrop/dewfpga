module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 4; i = i + 1) begin
      sw = {14'h2A5A, i[1:0]}; #1
      if (!(led === {14'd0, sw[1:0] == 2'b10, sw[1:0] == 2'b01})) begin $display("FAIL: unique0 if (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
