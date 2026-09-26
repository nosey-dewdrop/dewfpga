module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [1:0] z;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {8'h3C, i[7:0]}; #1
      z = sw[3] ? 2'd3 : sw[2] ? 2'd2 : sw[1] ? 2'd1 : 2'd0;      // casez: ? matches anything
      if (!(led === {13'd0, sw[7] & ~sw[4], z})) begin $display("FAIL: casez / casex (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
