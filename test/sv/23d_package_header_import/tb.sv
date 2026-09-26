module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 16; i = i + 1) begin
      sw = {12'hF0F, i[3:0]}; #1
      if (!(led === {12'd0, sw[3:0] ^ 4'hA})) begin $display("FAIL: imported constant (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
