module tb;
  reg [15:0] sw = 16'h0000;
  wire [15:0] led;
  reg [15:0] first;
  integer i;
  top dut(.sw(sw), .led(led));
  // IEEE 1800-2017 6.8: a variable's declaration assignment sets its start value once, before any process
  // runs, so sum does not follow sw afterwards
  initial begin
    #1 first = led;
    for (i = 1; i < 256; i = i + 1) begin
      sw = i * 16'h0101; #1
      if (led !== first) begin $display("FAIL: led follows sw (sw=%h led=%h, was %h): an initializer runs once", sw, led, first); $finish; end
    end
    $display("PASS"); $finish;
  end
endmodule
