module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {8'hC3, i[7:0]}; #1
      if (!(led === {12'd0, sw[3:0] ^ 4'h6})) begin $display("FAIL: two packages, one importing the other (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
