module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .seg(seg), .dp(dp), .an(an));
  // the reference: the 16 hex patterns (active low, gfedcba) and the digit order an = 1110, 1101, 1011, 0111
  reg [6:0] hex [0:15];
  reg [3:0] prev; integer n, p, k;
  initial begin
    hex[0] = 7'b1000000; hex[1] = 7'b1111001; hex[2] = 7'b0100100; hex[3] = 7'b0110000;
    hex[4] = 7'b0011001; hex[5] = 7'b0010010; hex[6] = 7'b0000010; hex[7] = 7'b1111000;
    hex[8] = 7'b0000000; hex[9] = 7'b0010000; hex[10] = 7'b0001000; hex[11] = 7'b0000011;
    hex[12] = 7'b1000110; hex[13] = 7'b0100001; hex[14] = 7'b0000110; hex[15] = 7'b0001110;
  end
  task check(input integer d); begin
    if (an !== ~(4'b0001 << d) || seg !== hex[sw[4*d +: 4]] || dp !== 1'b1) begin
      $display("FAIL: digit %0d of sw=%h: an=%b seg=%b, want an=%b seg=%b", d, sw, an, seg, ~(4'b0001 << d), hex[sw[4*d +: 4]]); $finish; end
  end endtask
  initial begin
    for (p = 0; p < 4; p = p + 1) begin
      sw = {4'(4*p + 3), 4'(4*p + 2), 4'(4*p + 1), 4'(4*p)};    // every hex digit shows once
      btnC = 1; tick; btnC = 0; #1
      check(0);
      for (k = 1; k <= 4; k = k + 1) begin               // the derived clock steps the digit; 4 wraps to 0
        prev = an; n = 0;
        while (an === prev && n < 12) begin tick; n = n + 1; end
        check(k % 4);
      end
    end
    $display("PASS"); $finish;
  end
endmodule
