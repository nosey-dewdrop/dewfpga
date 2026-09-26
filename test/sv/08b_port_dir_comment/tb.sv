module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i;
  top dut(.sw(sw), .seg(seg), .dp(dp), .an(an));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      if (!(seg === ~sw[6:0] && dp === sw[7] && an === ~sw[11:8])) begin $display("FAIL: seg, dp, an (sw=%h seg=%b dp=%b an=%b)", sw, seg, dp, an); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
