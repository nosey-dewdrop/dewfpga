module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {i[7:4], 8'h5a, i[3:0]}; #1
      if (!(led === {12'd0, 4'(sw[3:0] + 4'd1)})) begin $display("FAIL: inc(v) through ref (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
