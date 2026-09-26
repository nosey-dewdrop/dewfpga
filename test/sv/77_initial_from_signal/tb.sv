module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i, k;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #2000000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    for (i = 0; i < 64; i = i + 1) begin
      sw = (i * 16'h2f5b) ^ 16'hffc0; btnC = 1'b1; tick; btnC = 1'b0;
      if (!(led === sw)) begin $display("FAIL: btnC loads sw (led=%h sw=%h)", led, sw); $finish; end
      for (k = 1; k <= 3; k = k + 1) begin
        tick;
        if (!(led === 16'(sw + k))) begin $display("FAIL: counts up from sw (led=%h want %h)", led, 16'(sw + k)); $finish; end
      end
    end
    $display("PASS"); $finish;
  end
endmodule
