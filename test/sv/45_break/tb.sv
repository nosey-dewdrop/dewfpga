module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i, b, k;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      k = -1; for (b = 15; b >= 0; b = b - 1) if (sw[b]) k = b;
      if (!(led === (k < 0 ? 16'd0 : {11'd0, 1'b1, 4'(k)}))) begin $display("FAIL: break, lowest set bit (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
