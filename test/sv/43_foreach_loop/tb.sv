module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      if (!(led === {4'(sw[15:12] + 3), 4'(sw[11:8] + 2), 4'(sw[7:4] + 1), sw[3:0]})) begin $display("FAIL: foreach, nibble + index (sw=%h led=%h)", sw, led); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
