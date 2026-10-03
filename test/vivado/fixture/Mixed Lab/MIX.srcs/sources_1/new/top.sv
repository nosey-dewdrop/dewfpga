`include "defs.svh"
module top(input logic [`W-1:0] sw, output logic led);
    logic unused;
    helper u_h(.a(sw), .y(unused));
    assign led = u_h.y;   // a hierarchical name: yosys' reader stops on it, yosys-slang reads it
endmodule
