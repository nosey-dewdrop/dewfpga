module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg;
  integer i;
  top dut(.sw(sw), .led(led), .seg(seg));
  initial begin
    for (i = 0; i < 16; i = i + 1) begin
      sw = {12'hA5C, i[3:0]}; #1
      if (!(led === sw && seg === {sw[0], sw[1], sw[2], sw[3], ^sw[3:0], &sw[3:0], |sw[3:0]})) begin $display("FAIL: display (sw=%h seg=%b)", sw, seg); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
