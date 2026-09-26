module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [1:0] pri;
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 256; i = i + 1) begin
      sw = {8'hC3, i[7:0]}; #1
      pri = sw[7] ? 2'd3 : sw[6] ? 2'd2 : sw[5] ? 2'd1 : 2'd0;     // priority casez: the first matching item wins
      if (!(led === {10'd0, pri, 4'd1 << sw[1:0]})) begin $display("FAIL: unique case / priority casez (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
