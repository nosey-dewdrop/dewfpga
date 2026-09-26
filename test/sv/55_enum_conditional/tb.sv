module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer s, v; reg [1:0] want;
  top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));
  // from reset to state s: IDLE, then RUN with sw[0] up, then DONE with sw[1] up
  task goto(input integer s); begin
    btnC = 1'b1; sw = 16'h0000; tick; btnC = 1'b0;
    if (s >= 1) begin sw = 16'h0001; tick; end
    if (s >= 2) begin sw = 16'h0002; tick; end
    if (!(led === {14'd0, s[1:0]})) begin $display("FAIL: reach state %0d (led=%h)", s, led); $finish; end
  end endtask
  initial begin
    // every reachable state, with every value of sw[2:0] and btnC (the other switches vary too)
    for (s = 0; s < 3; s = s + 1)
      for (v = 0; v < 16; v = v + 1) begin
        goto(s);
        sw = {13'(v * 16'h2b9 + s * 16'h1c3), v[2:0]}; btnC = v[3]; tick; btnC = 1'b0;
        want = v[3] ? 2'd0 : (s == 0) ? (v[0] ? 2'd1 : 2'd0) : (s == 1) ? (v[1] ? 2'd2 : 2'd1) : (v[2] ? 2'd0 : 2'd2);
        if (!(led === {14'd0, want})) begin $display("FAIL: state %0d, sw[2:0]=%b, btnC=%b: next %0d (led=%h)", s, v[2:0], v[3], want, led); $finish; end
      end
    $display("PASS"); $finish;
  end
endmodule
