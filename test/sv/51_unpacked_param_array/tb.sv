module tb;
  reg clk = 1'b0;
  reg btnC = 1'b0, btnU = 1'b0, btnD = 1'b0, btnL = 1'b0, btnR = 1'b0;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led; wire [6:0] seg; wire dp; wire [3:0] an;
  task tick; begin #5 clk = 1'b1; #5 clk = 1'b0; end endtask
  initial begin #200000 $display("FAIL: timeout"); $finish; end
  integer i; reg [6:0] want;
  top dut(.sw(sw), .led(led));
  initial begin
    for (i = 0; i < 65536; i = i + 1) begin
      sw = i; #1
      case (sw[1:0]) 0: want = 7'h40; 1: want = 7'h79; 2: want = 7'h24; default: want = 7'h30; endcase
      if (!(led === {9'd0, want})) begin $display("FAIL: SEGS[sw[1:0]] (sw=%h led=%h want %h)", sw, led, want); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
