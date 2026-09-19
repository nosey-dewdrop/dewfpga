// blink.sv — Basys3'te ışık yakma
//
// sw[0]  : ışığı aç/kapat
// led[0] : yanıp söner (~1 Hz)
// led[15]: sw[0] doğrudan bağlı — kartın canlı olduğunu anında gösterir

module blink (
    input  logic        clk,      // W5 — 100 MHz kart osilatörü
    input  logic [15:0] sw,
    output logic [15:0] led
);

    // 100 MHz'i saymak: 50_000_000 çevrimde bir tersle -> ~1 Hz (yarım periyot)
    localparam int HALF_PERIOD = 50_000_000;

    logic [25:0] counter = '0;   // 2^26 = 67M, 50M'i tutar
    logic        blink_state = 1'b0;

    always_ff @(posedge clk) begin
        if (counter == HALF_PERIOD - 1) begin
            counter     <= '0;
            blink_state <= ~blink_state;
        end else begin
            counter <= counter + 1'b1;
        end
    end

    always_comb begin
        led        = '0;
        led[0]     = blink_state & sw[0];  // sw[0] açıkken yanıp söner
        led[15]    = sw[0];                // anahtarın aynası
    end

endmodule
