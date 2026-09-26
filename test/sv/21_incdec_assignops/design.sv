module top(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);
  logic [7:0] cnt, acc, nxt_cnt, nxt_acc;
  logic [3:0] k;
  logic [4:0] c;
  always_comb begin
    nxt_cnt = cnt; nxt_cnt++;
    nxt_acc = acc; nxt_acc += {4'd0, sw[3:0]};
  end
  always_ff @(posedge clk)
    if (btnC) begin cnt <= '0; acc <= '0; end
    else begin cnt <= nxt_cnt; acc <= nxt_acc; end
  always_ff @(posedge clk)
    if (btnC) k <= '0; else k++;              // student style: ++ inside always_ff
  always_comb begin
    c = '0;
    for (int i = 0; i < 16; i++) if (sw[i]) c++;
  end
  assign led = {k, c[3:0], acc[3:0], cnt[3:0]};
endmodule
