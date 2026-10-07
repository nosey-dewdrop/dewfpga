module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  top dut(.sw(sw), .led(led));
  // first-match semantics, as iverilog simulates it (it ignores unique): sw = 000B matches both items and
  // the simulation takes the first (led = 1); the netlist ORs both items (led = 3), so the board would differ
  initial begin
    sw = 16'h000B; #1 if (led !== 16'd1) begin $display("FAIL: sw=%h led=%h, expected 1", sw, led); $finish; end
    sw = 16'h0008; #1 if (led !== 16'd1) begin $display("FAIL: sw=%h led=%h, expected 1", sw, led); $finish; end
    sw = 16'h0003; #1 if (led !== 16'd2) begin $display("FAIL: sw=%h led=%h, expected 2", sw, led); $finish; end
    $display("PASS"); $finish;
  end
endmodule
