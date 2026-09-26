module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 16; i = i + 1) begin
      sw = {i[3:0], 11'h2a5, i[0]}; #1
      if (!(led === {sw[15:1], ~sw[0]})) begin $display("FAIL: inv kept as its own module (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
