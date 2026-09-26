module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {8'hc3, i[7:0]}; #1
      if (!(led === {11'd0, 4'(sw[7:4] + 4'd1), sw[0] ^ sw[1]})) begin $display("FAIL: final and bit (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
