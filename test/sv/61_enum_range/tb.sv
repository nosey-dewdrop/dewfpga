module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i; reg [1:0] s; reg [2:0] t;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 8; i = i + 1) begin
      sw = {13'h1abc, i[2:0]}; #1
      s = (sw[1:0] == 2'd0) ? 2'd2 : (sw[1:0] == 2'd1) ? 2'd0 : 2'd1;
      t = sw[2] ? 3'd2 : 3'd1;
      if (!(led === {11'd0, t, s})) begin $display("FAIL: S0..S2 and T5..T7 values (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
