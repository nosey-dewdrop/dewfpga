module tb;
  reg clk = 1'b0, btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  integer i; reg [1:0] s;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  initial begin
    #1 btnC = 1'b1; #1 btnC = 1'b0; s = 2'd0;
    for (i = 0; i < 64; i = i + 1) begin
      sw = {15'd0, i[1] ^ i[3]}; #1
      if (!(led === {s == 2'd1, 13'd0, s})) begin $display("FAIL: state on led[1:0], busy on led[15] (step %0d, led=%h, want state %0d)", i, led, s); $finish; end
      tick;
      s = (s == 2'd0) ? (sw[0] ? 2'd1 : 2'd0) : (s == 2'd1) ? 2'd2 : 2'd0;
    end
    $display("PASS"); $finish;
  end
endmodule
