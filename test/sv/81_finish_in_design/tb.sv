module tb;
  reg clk = 1'b0, btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [15:0] want;
  integer i;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin
    btnC = 1'b1; tick; btnC = 1'b0; want = 16'd0;
    for (i = 0; i < 40; i = i + 1) begin
      sw = {i[0], 15'h1234 ^ i[14:0]}; #1
      if (!(led === (sw[15] ? sw : want))) begin $display("FAIL: the counter or the switch mux (i=%0d led=%h)", i, led); $finish; end
      tick; want = want + 16'd1;
    end
    $display("PASS"); $finish;
  end
endmodule
