module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  wire [7:0] JA; reg oe0 = 1'b0, d0 = 1'b0, oe1 = 1'b0, d1 = 1'b0;
  assign JA[0] = oe0 ? d0 : 1'bz;
  assign JA[1] = oe1 ? d1 : 1'bz;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.sw(sw), .led(led), .JA(JA));
  initial begin
    sw = 16'h0003; #1
    if (led[0] !== 1'b1) begin $display("FAIL: design drives JA[0]=1, led0=%b", led[0]); $finish; end
    sw = 16'h0001; #1
    if (led[0] !== 1'b0) begin $display("FAIL: design drives JA[0]=0, led0=%b", led[0]); $finish; end
    sw = 16'h0000; oe0 = 1; d0 = 1; #1
    if (led[0] !== 1'b1) begin $display("FAIL: released pin, tb drives 1, led0=%b", led[0]); $finish; end
    d0 = 0; #1
    if (led[0] !== 1'b0) begin $display("FAIL: released pin, tb drives 0, led0=%b", led[0]); $finish; end
    oe1 = 1; d1 = 1; #1
    if (led[1] !== 1'b1) begin $display("FAIL: JA[1] input, led1=%b", led[1]); $finish; end
    $display("PASS"); $finish;
  end
endmodule
