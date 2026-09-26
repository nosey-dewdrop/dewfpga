module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 64; i = i + 1) begin
      sw = {10'h155, i[5:0]}; #1
      if (!(led === {14'd0, sw[3:2] == sw[5:4], sw[0] & sw[1]})) begin $display("FAIL: w and eq (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
