module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [15:0] want;
  integer i, k;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 32; i = i + 1) begin
      sw = {11'h5A3, i[4:0]}; #1
      want = 16'd0;                              // one-hot: the lowest zero among sw[3:0], none if all ones
      for (k = 3; k >= 0; k = k - 1) if (!sw[k]) want = 16'd1 << k;
      if (!(led === want)) begin $display("FAIL: first zero (sw=%h led=%h want=%h)", sw, led, want); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
