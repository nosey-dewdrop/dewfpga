module tb;
  reg clk = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i; reg [15:0] last;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #2000000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .sw(sw), .led(led));
  initial begin
    for (i = 0; i < 4096; i = i + 1) begin
      sw = (i * 16'h9e37) ^ (i >> 3); last = sw; tick;
      sw = ~sw; #1
      if (!(led === last)) begin $display("FAIL: b <= a copies all four elements (led=%h want %h)", led, last); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
