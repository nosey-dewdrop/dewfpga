// blink.sv: light an LED on the Basys3
//
// sw[0]  : enable
// led[0] : blinks at ~1 Hz while sw[0] is on
// led[15]: mirrors sw[0]: shows the board is alive instantly

module blink (
    input  logic        clk,      // W5: 100 MHz on-board oscillator
    input  logic [15:0] sw,
    output logic [15:0] led
);

    // count 100 MHz: toggle every 50_000_000 cycles -> ~1 Hz (half period)
`ifdef SIM
    localparam int HALF_PERIOD = 64;           // the browser simulator defines SIM: keep the blink watchable
`else
    localparam int HALF_PERIOD = 50_000_000;
`endif

    logic [25:0] counter = '0;   // 2^26 = 67M, holds 50M
    logic        blink_state = 1'b0;

    always_ff @(posedge clk) begin
        if (counter == HALF_PERIOD - 1) begin
            counter     <= '0;
            blink_state <= ~blink_state;
        end else begin
            counter <= counter + 1'b1;
        end
    end

    assign led = {sw[0], 14'b0, blink_state & sw[0]};

endmodule
