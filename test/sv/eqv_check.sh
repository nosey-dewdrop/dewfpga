#!/usr/bin/env bash
# A check of the netlist stage's comparison itself: a small RTL (module top) and a netlist (also module top)
# that differs from it in one known way. The netlist arrives as the product's does (yosys JSON, the cell
# library as blackboxes), and the runner's own eqv.sh compares it with the RTL, as the netlist stage does:
# its eqv.py --netlist, its listing of the RTL's registers, its bench. The bench has to see every difference.
#   test/sv/eqv_check.sh <case>     exit 0 when the bench gives the verdict the case expects: EQV PASS, or an
#                                   EQV FAIL that counts differing output bits (a bench that does not compile,
#                                   or compares nothing, is neither), or one of those two FAILs by name
#   equal      the netlist is the RTL                                 EQV PASS
#   msb        only led[15] differs, on one input in sixteen          EQV FAIL (every output bit is compared)
#   zero       only at sw=0000, no clock                              EQV FAIL (the walk starts at the all-zero input)
#   walk       only at sw=1234, no clock                              EQV FAIL (every input combination, not a sample)
#   cbutton    only while btnC is pressed, no clock                   EQV FAIL (the walk moves the buttons too)
#   ones       a clocked design, only at sw=ffff                      EQV FAIL (random cycles include all ones)
#   dense      a clocked design, only at sw=7fff                      EQV FAIL (and mostly-ones values)
#   sparse     a clocked design, only at sw=0100                      EQV FAIL (and mostly-zeros values)
#   deep       a counter, only once it reaches 4000                   EQV FAIL (all 4096 cycles run)
#   button     a clocked design, wrong when btnC is pressed later on  EQV FAIL (the buttons are pressed, not
#                                                                     only in the reset at the start)
#   zout       led[15] left undriven (z)                              EQV FAIL (a z is not a value)
#   xout       led[15] driven with x                                  EQV FAIL (nor is an x)
#   init       a flip-flop whose INIT is x, the RTL starts it at 0    EQV PASS (the board starts it at 0)
#   fdse       an FDSE whose INIT is x, the RTL starts it at 1        EQV PASS (nextpnr starts an FDSE at 1)
#   ldpe       an LDPE whose INIT is x, the RTL starts it at 0        EQV PASS (and an LDPE at 0)
#   ldfill     the same latch with no start value in the RTL          EQV PASS (the RTL's latch starts at 0 too,
#                                                                     though its preset sets it to 1)
#   lostinit   the RTL starts a counter at 5, the netlist lost it     EQV FAIL (the start value is compared)
#   xstart     a state register with no start value, read by a case,  EQV PASS (the RTL starts it at the board's
#              reset from two switches (sw[15] & sw[14]: logic, so    0, so its case takes the board's branch)
#              the bench does not press it first; also below)
#   fillset    a register with no start value and a synchronous set   EQV PASS (the RTL starts it at 1, as the
#              from two switches; the netlist has FDSEs               board's FDSEs; with 0 it would differ)
#   fillaset   the same with an asynchronous set; FDPEs               EQV PASS (1 for an FDPE too)
#   pkenum     a packed array of enums with no start value, read by   EQV PASS (the RTL is started whole: a bit
#              a case (07's statetype [1:0] state)                    select would pick an enum, not a bit)
#   enum1      a 1-bit enum with no start value, read by a case      EQV PASS (it is started with its item)
#   lostreset  a counter whose synchronous reset the netlist dropped  EQV FAIL (after the reset every
#                                                                     difference counts)
#   recode     a state machine re-encoded one-hot: on the board it    EQV PASS (the bench presses every button
#              starts in no state until its reset, where the RTL      once before it compares)
#              shows IDLE
#   hier       a kept submodule with the same name as the RTL's       EQV PASS (the netlist's modules are renamed)
#   hierfault  the same, with a fault inside the kept submodule       EQV FAIL (and the netlist's copy is the one run)
#   names      ports named x, mode, seed, r, n, v, k                  EQV PASS (the bench's own names cannot clash)
#   ioequal    an inout pin driven, read back, and one left floating  EQV PASS
#   ioread     the netlist reads an inout pin inverted                EQV FAIL (the pins are driven from outside)
#   iofloat    the netlist drives a pin the RTL leaves floating       EQV FAIL (the pins themselves are compared)
#   mealyb     led[0] = q & btnC, lost in the netlist: it shows only  EQV FAIL (the outputs are compared after
#              between a button change and the next clock edge        the buttons change, before the edge)
#   xstarta    xstart with an asynchronous reset (FDCE)               EQV PASS (async-reset registers are started)
#   xstartl    a latch with no start value, read by a case (LDCE)     EQV PASS (latches are started, at 0)
#   fillasym   a synchronous reset to 4'b0011 from two switches:      EQV PASS (each bit gets its own reset
#              FDSE bits 0-1, FDRE bits 2-3                           value, in the right order)
#   subreg     a counter in its own module, no reset or start value;  EQV PASS (the RTL's registers are listed
#              top's wire q has the name of the submodule's q        after flatten; the submodule's q is started)
#   subfault   the same, and the netlist's counter counts down        EQV FAIL (so its q is compared)
#   regport    top's register n feeds a submodule's input port D,     EQV PASS (the start goes to n, not to the
#              next to top's register D (a CS223 Lab 4 counter)       port A1.D, a net the bench cannot set)
#   regslice   an output register led, and wire [3:0] low = led[3:0]  EQV PASS (the start goes to led, the name
#                                                                     its always block writes, not to low)
#   alias      a register state and assign alias_w = state, whose     EQV PASS (the same: the name the always
#              name sorts first                                       block writes)
#   enum1sub   1-bit enums declared in a submodule and at file scope  EQV PASS (each is started with its item,
#                                                                     wherever the enum is declared)
#   enumstart  a 2-bit enum state with no start value; the netlist    EQV FAIL (a multi-bit enum is started too)
#              powers up in state 11, which the RTL never has
#   memstart   a LUT RAM with no start value; the netlist's RAM       EQV FAIL (memories are started, at 0)
#              powers up all ones
#   datasw     a clocked design, led[0] = (q == sw[3:0]) made a       EQV FAIL (the outputs are compared after
#              constant 1: wrong only between a switch change and     the switches change, before the edge)
#              the next clock edge
#   nobench    the netlist has a port the RTL lacks, so the bench     EQV FAIL by name (the RTL compiles, the
#              does not compile                                       bench does not: never a SKIP)
#   pkgfile    the RTL reads a package from its own file, named so    EQV PASS (packages are compiled first)
#              that it sorts after the design
#   nothing    the RTL drives every output with z                     EQV FAIL by name (nothing compared)
#   romstart   a counter with no start value whose netlist holds its  EQV PASS (the run follows the RTL as dewfpga
#              first state one clock longer, as yosys makes it when   sim starts it: x until the case's default,
#              it moves the register into a ROM (a Lab 4 counter)     then known; the board does what sim shows)
#   mixstart   the same counter twice in the netlist, one as the      EQV FAIL (the run has to follow one start
#              board starts it and one a clock later, bit 0 from the  throughout, the same at every bit)
#              first and bits 2:1 from the second
#   simflip    a digit-select counter, no reset, no start value, read EQV FAIL (sim's copy keeps sel at x, so its
#              by a case; one LUT bit of its netlist flipped: 1111    case shows the default 1111 at every compare
#              where the board shows 1110 (digit 0 never lights)      and proves nothing: the run follows neither
#                                                                     start, though each compare matches one)
#   simlost    the same counter, lost: the netlist shows 1111, what   EQV FAIL (the same: the board's start is the
#              dewfpga sim shows at every compare                     one that counts while sel is x)
#   xhold      a RAM never written, read at a registered address; the EQV FAIL (sim's copy reads x there, and an x
#              netlist reads x where the board reads 0                in it excuses nothing, even an x netlist)
#   swreset    recode, its reset on sw[15] instead of btnC            EQV PASS (an input bit that resets a register
#                                                                     is pressed first, like a button)
#   partassign a counter on led[3:0], assign led[15:4] = sw[15:4]     EQV PASS (a register that shares its variable
#                                                                     with an assign is started bit by bit)
#   negset     falling-edge registers with no start value, a          EQV PASS (nextpnr starts an FDSE_1 and an
#              synchronous set (FDSE_1) and an asynchronous one       FDPE_1 at 1, and so does the RTL)
#              (FDPE_1), both from two switches
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CELLS="$(yosys-config --datdir)/xilinx/cells_sim.v"
W=${EQV_KEEP:-$(mktemp -d)}; [ -n "${EQV_KEEP:-}" ] || trap 'rm -rf "$W"' EXIT
comb='(input logic [15:0] sw, output logic [15:0] led);'
clkd='(input logic clk, input logic [15:0] sw, output logic [15:0] led);'
btnd='(input logic clk, input logic btnC, input logic [15:0] sw, output logic [15:0] led);'
cbtn='(input logic btnC, input logic [7:0] sw, output logic [7:0] led);'
lat='(input logic btnC, input logic [3:0] sw, output logic [15:0] led);'
iop='(input logic [3:0] sw, inout wire [3:0] JA, output logic [3:0] led);'
reg="logic [15:0] q = '0; always_ff @(posedge clk)"
inv="module inv(input logic a, output logic y); assign y = ~a; endmodule"
# a counter with no reset and no start value in its own module; in the netlist as flip-flops the board starts at 0
div="module div(input logic clk, output logic [3:0] q); always_ff @(posedge clk) q <= q + 4'd1; endmodule"
ndiv="module div(input logic clk, output logic [3:0] q); logic [3:0] d; assign d = q + 4'd1;
            for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(q[i])); endmodule"
dff="module dff(input logic D, input logic clk, output logic Q); always_ff @(posedge clk) Q <= D; endmodule"
ndff="module dff(input logic D, input logic clk, output logic Q); FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(D), .Q(Q)); endmodule"
# the state machine of recode: IDLE -> ONE on sw[0], ONE -> TWO on sw[1], TWO -> IDLE; led[1] in TWO, led[0] in IDLE
fsm="typedef enum logic [1:0] {IDLE, ONE, TWO} st_t; st_t s;
            always_ff @(posedge clk) if (btnC) s <= IDLE; else case (s) IDLE: if (sw[0]) s <= ONE; ONE: if (sw[1]) s <= TWO; else s <= IDLE; default: s <= IDLE; endcase
            assign led = {14'd0, s == TWO, s == IDLE};"
# a counter that steps through a case with a default, no start value: dewfpga sim starts it at x, and the
# default takes it to 0 at the first edge, one step behind the board's start at 0
cnt="case (q) 3'd0: q <= 3'd1; 3'd1: q <= 3'd2; 3'd2: q <= 3'd3; 3'd3: q <= 3'd4; 3'd4: q <= 3'd5; 3'd5: q <= 3'd6; 3'd6: q <= 3'd7; 3'd7: q <= 3'd0; default: q <= 3'd0; endcase"
# its netlist: flip-flops that start at 0 (a), and a copy that holds its first state one clock longer (b)
ncnt="logic st; FDRE #(.INIT(1'b0)) fs (.C(clk), .CE(1'b1), .R(1'b0), .D(1'b1), .Q(st));
            logic [2:0] a, b; wire [2:0] da = a + 3'd1, db = st ? b + 3'd1 : b;
            for (genvar i = 0; i < 3; i++) begin FDRE #(.INIT(1'b0)) fa (.C(clk), .CE(1'b1), .R(1'b0), .D(da[i]), .Q(a[i]));
              FDRE #(.INIT(1'b0)) fb (.C(clk), .CE(1'b1), .R(1'b0), .D(db[i]), .Q(b[i])); end"
# a digit-select counter with no reset and no start value: dewfpga sim keeps sel at x, and its case takes the
# default, 1111, at every compare; the board counts from 0. Its netlist, flip-flops the board starts at 0
digit="always_comb case (sel) 2'd0: led = 16'b1110; 2'd1: led = 16'b1101; 2'd2: led = 16'b1011; default: led = 16'b1111; endcase"
nsel="logic [1:0] sel, d; assign d = sel + 2'd1; for (genvar i = 0; i < 2; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(sel[i]));"
pre=""; npre=""; pkgf=""  # modules written before top, in the RTL and in the netlist; a package in its own file
case ${1:-} in
    equal)  ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault=$body; want=PASS ;;
    msb)    ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault="assign led = sw ^ 16'h5a5a ^ {sw[3:0] == 4'ha, 15'd0};"; want=FAIL ;;
    zero)   ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault="assign led = sw ^ 16'h5a5a ^ {15'd0, sw == 16'h0000};"; want=FAIL ;;
    walk)   ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault="assign led = sw ^ 16'h5a5a ^ {15'd0, sw == 16'h1234};"; want=FAIL ;;
    cbutton) ports=$cbtn; body="assign led = btnC ? sw : ~sw;"; fault="assign led = btnC ? sw ^ 8'h01 : ~sw;"; want=FAIL ;;
    ones)   ports=$clkd; body="$reg q <= sw; assign led = q;"; fault="$reg q <= sw ^ {15'd0, sw == 16'hffff}; assign led = q;"; want=FAIL ;;
    dense)  ports=$clkd; body="$reg q <= sw; assign led = q;"; fault="$reg q <= sw ^ {15'd0, sw == 16'h7fff}; assign led = q;"; want=FAIL ;;
    sparse) ports=$clkd; body="$reg q <= sw; assign led = q;"; fault="$reg q <= sw ^ {15'd0, sw == 16'h0100}; assign led = q;"; want=FAIL ;;
    deep)   ports=$clkd; body="logic [11:0] c = '0; always_ff @(posedge clk) c <= c + 12'd1; assign led = {sw[3:0], c};"
            fault="logic [11:0] c = '0; always_ff @(posedge clk) c <= c + 12'd1; assign led = {sw[3:0], c} ^ {15'd0, c == 12'd4000};"; want=FAIL ;;
    button) ports=$btnd; body="$reg if (btnC) q <= '0; else q <= sw; assign led = q;"
            fault="$reg if (btnC) q <= (q == '0) ? '0 : 16'h0001; else q <= sw; assign led = q;"; want=FAIL ;;
    zout)   ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault="assign led[14:0] = sw[14:0] ^ 15'h5a5a;"; want=FAIL ;;
    xout)   ports=$comb; body="assign led = sw ^ 16'h5a5a;"; fault="assign led = {1'bx, sw[14:0] ^ 15'h5a5a};"; want=FAIL ;;
    init)   ports=$clkd; body="bit [3:0] q; always_ff @(posedge clk) q <= sw[3:0]; assign led = {12'd0, q};"
            fault="logic [3:0] q; for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(sw[i]), .Q(q[i])); assign led = {12'd0, q};"; want=PASS ;;
    fdse)   ports=$clkd; body="logic q = 1'b1; always_ff @(posedge clk) if (sw[0]) q <= sw[1]; assign led = {15'd0, q};"
            fault="logic q; FDSE #(.INIT(1'bx)) f (.C(clk), .CE(sw[0]), .S(1'b0), .D(sw[1]), .Q(q)); assign led = {15'd0, q};"; want=PASS ;;
    ldpe)   ports=$lat; body="logic q = 1'b0; always_latch if (btnC) q = 1'b1; else if (sw[1]) q = sw[0]; assign led = {15'd0, q};"
            fault="logic q; LDPE #(.INIT(1'bx)) l (.G(sw[1]), .GE(1'b1), .PRE(btnC), .D(sw[0]), .Q(q)); assign led = {15'd0, q};"; want=PASS ;;
    ldfill) ports=$lat; body="logic q; always_latch if (btnC) q = 1'b1; else if (sw[1]) q = sw[0]; assign led = {15'd0, q};"
            fault="logic q; LDPE #(.INIT(1'bx)) l (.G(sw[1]), .GE(1'b1), .PRE(btnC), .D(sw[0]), .Q(q)); assign led = {15'd0, q};"; want=PASS ;;
    lostinit) ports=$clkd; body="logic [3:0] q = 4'd5; always_ff @(posedge clk) q <= q + 4'd1; assign led = {12'd0, q};"
            fault="logic [3:0] q, d; assign d = q + 4'd1; for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(q[i])); assign led = {12'd0, q};"; want=FAIL ;;
    xstart) ports=$clkd; body="logic [1:0] s; always_ff @(posedge clk) if (sw[15] & sw[14]) s <= '0; else s <= s + 2'd1;
            always_comb case (s) 2'd0: led = 16'd1; default: led = 16'd2; endcase"
            fault="logic [1:0] s, d; assign d = s + 2'd1; for (genvar i = 0; i < 2; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(sw[15] & sw[14]), .D(d[i]), .Q(s[i]));
            assign led = {14'd0, s == 2'd0 ? 2'd1 : 2'd2};"; want=PASS ;;
    fillset) ports=$clkd; body="logic [3:0] q; always_ff @(posedge clk) if (sw[15] & sw[14]) q <= '1; else q <= q + 4'd1; assign led = {12'd0, q};"
            fault="logic [3:0] q, d; assign d = q + 4'd1; for (genvar i = 0; i < 4; i++) FDSE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .S(sw[15] & sw[14]), .D(d[i]), .Q(q[i])); assign led = {12'd0, q};"; want=PASS ;;
    fillaset) ports=$clkd; body="logic [3:0] q; wire set = sw[15] & sw[14]; always_ff @(posedge clk, posedge set) if (set) q <= '1; else q <= q + 4'd1; assign led = {12'd0, q};"
            fault="logic [3:0] q, d; assign d = q + 4'd1; for (genvar i = 0; i < 4; i++) FDPE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .PRE(sw[15] & sw[14]), .D(d[i]), .Q(q[i])); assign led = {12'd0, q};"; want=PASS ;;
    pkenum) ports=$clkd; body="typedef enum logic [1:0] {S0, S1, S2, S3} st_t; st_t [1:0] s; always_ff @(posedge clk) s <= {s[0], st_t'(sw[1:0])};
            always_comb case (s[1]) S0: led = 16'd1; default: led = 16'd2; endcase"
            fault="logic [3:0] s; for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(i < 2 ? sw[i] : s[i - 2]), .Q(s[i]));
            assign led = {14'd0, s[3:2] == 2'd0 ? 2'd1 : 2'd2};"; want=PASS ;;
    enum1)  ports=$clkd; body="typedef enum logic {OFF, ON} t_t; t_t e; always_ff @(posedge clk) if (sw[0]) e <= t_t'(sw[1]);
            always_comb case (e) OFF: led = 16'd1; default: led = 16'd2; endcase"
            fault="logic e; FDRE #(.INIT(1'bx)) f (.C(clk), .CE(sw[0]), .R(1'b0), .D(sw[1]), .Q(e)); assign led = {14'd0, e ? 2'd2 : 2'd1};"; want=PASS ;;
    lostreset) ports=$btnd; body="logic [3:0] c; always_ff @(posedge clk) if (btnC) c <= '0; else c <= c + 4'd1; assign led = {12'd0, c};"
            fault="logic [3:0] c, d; assign d = c + 4'd1; for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(c[i])); assign led = {12'd0, c};"; want=FAIL ;;
    recode) ports=$btnd; body=$fsm
            fault="logic [2:0] h, d;   // one-hot: h[0] IDLE, h[1] ONE, h[2] TWO; all zero at power-up is no state
            assign d[0] = btnC | (h[0] & ~sw[0]) | (h[1] & ~sw[1]) | h[2];
            assign d[1] = ~btnC & h[0] & sw[0];
            assign d[2] = ~btnC & h[1] & sw[1];
            for (genvar i = 0; i < 3; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(h[i]));
            assign led = {14'd0, h[2], h[0]};"; want=PASS ;;
    hier)   ports=$comb; pre=$inv; npre=$inv; body="inv u0 (.a(sw[0]), .y(led[0])); assign led[15:1] = sw[15:1];"; fault=$body; want=PASS ;;
    hierfault) ports=$comb; pre=$inv; npre="module inv(input logic a, output logic y); assign y = a; endmodule"
            body="inv u0 (.a(sw[0]), .y(led[0])); assign led[15:1] = sw[15:1];"; fault=$body; want=FAIL ;;
    names)  ports='(input logic clk, input logic [3:0] x, input logic mode, input logic seed, input logic r, input logic n, input logic v, input logic k, output logic [7:0] led);'
            body="logic [3:0] q = '0; always_ff @(posedge clk) q <= mode ? ~x : x; assign led = {q, seed, r, n, v ^ k};"; fault=$body; want=PASS ;;
    ioequal) ports=$iop; body="assign JA[0] = sw[0] ? sw[1] : 1'bz; assign led = {JA[2:0], sw[3]};"; fault=$body; want=PASS ;;
    ioread) ports=$iop; body="assign JA[0] = sw[0] ? sw[1] : 1'bz; assign led = {JA[2:0], sw[3]};"
            fault="assign JA[0] = sw[0] ? sw[1] : 1'bz; assign led = {JA[2], ~JA[1], JA[0], sw[3]};"; want=FAIL ;;
    iofloat) ports=$iop; body="assign JA[0] = sw[0] ? sw[1] : 1'bz; assign led = {JA[2:0], sw[3]};"
            fault="assign JA[0] = sw[0] ? sw[1] : 1'bz; assign JA[3] = 1'b0; assign led = {JA[2:0], sw[3]};"; want=FAIL ;;
    mealyb) ports=$btnd; body="logic q = 1'b0; always_ff @(posedge clk) if (btnC) q <= 1'b0; else q <= sw[0]; assign led = {15'd0, q & btnC};"
            fault="logic q = 1'b0; always_ff @(posedge clk) if (btnC) q <= 1'b0; else q <= sw[0]; assign led = 16'd0;"; want=FAIL ;;
    xstarta) ports=$clkd; body="logic [1:0] s; wire rst = sw[15] & sw[14]; always_ff @(posedge clk, posedge rst) if (rst) s <= '0; else s <= s + 2'd1;
            always_comb case (s) 2'd0: led = 16'd1; default: led = 16'd2; endcase"
            fault="logic [1:0] s, d; assign d = s + 2'd1; for (genvar i = 0; i < 2; i++) FDCE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .CLR(sw[15] & sw[14]), .D(d[i]), .Q(s[i]));
            assign led = {14'd0, s == 2'd0 ? 2'd1 : 2'd2};"; want=PASS ;;
    xstartl) ports=$lat; body="logic [1:0] s; always_latch if (sw[1]) s = sw[3:2];
            always_comb case (s) 2'd0: led = 16'd1; default: led = 16'd2; endcase"
            fault="logic [1:0] s; for (genvar i = 0; i < 2; i++) LDCE #(.INIT(1'bx)) l (.G(sw[1]), .GE(1'b1), .CLR(1'b0), .D(sw[2+i]), .Q(s[i]));
            assign led = {14'd0, s == 2'd0 ? 2'd1 : 2'd2};"; want=PASS ;;
    fillasym) ports=$clkd; body="logic [3:0] q; always_ff @(posedge clk) if (sw[15] & sw[14]) q <= 4'b0011; else q <= q + 4'd1; assign led = {12'd0, q};"
            fault="logic [3:0] q, d; assign d = q + 4'd1; for (genvar i = 0; i < 2; i++) FDSE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .S(sw[15] & sw[14]), .D(d[i]), .Q(q[i]));
            for (genvar i = 2; i < 4; i++) FDRE #(.INIT(1'bx)) g (.C(clk), .CE(1'b1), .R(sw[15] & sw[14]), .D(d[i]), .Q(q[i])); assign led = {12'd0, q};"; want=PASS ;;
    subreg) ports=$clkd; pre=$div; npre=$ndiv; body="logic [3:0] q; div u_div (.clk(clk), .q(q)); assign led = {q, sw[11:0]};"; fault=$body; want=PASS ;;
    subfault) ports=$clkd; pre=$div; npre=${ndiv/q + 4/q - 4}; body="logic [3:0] q; div u_div (.clk(clk), .q(q)); assign led = {q, sw[11:0]};"; fault=$body; want=FAIL ;;
    regport) ports=$clkd; pre=$dff; npre=$ndff; body="logic D, n; always_ff @(posedge clk) begin D <= sw[0]; n <= sw[1]; end
            dff A1 (.D(n), .clk(clk), .Q(led[0])); assign led[1] = D; assign led[15:2] = '0;"
            fault="logic D, n; FDRE #(.INIT(1'bx)) fd (.C(clk), .CE(1'b1), .R(1'b0), .D(sw[0]), .Q(D)); FDRE #(.INIT(1'bx)) fn (.C(clk), .CE(1'b1), .R(1'b0), .D(sw[1]), .Q(n));
            dff A1 (.D(n), .clk(clk), .Q(led[0])); assign led[1] = D; assign led[15:2] = '0;"; want=PASS ;;
    regslice) ports=$btnd; body="logic [7:0] acc; wire [3:0] low; assign low = led[3:0];
            always_ff @(posedge clk) if (btnC) begin led <= '0; acc <= '0; end else begin led <= {led[7:0], acc}; acc <= acc + sw[7:0]; end"
            fault="logic [7:0] acc; wire [3:0] low; assign low = led[3:0]; wire [15:0] dl = {led[7:0], acc}; wire [7:0] da = acc + sw[7:0];
            for (genvar i = 0; i < 16; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(btnC), .D(dl[i]), .Q(led[i]));
            for (genvar i = 0; i < 8; i++) FDRE #(.INIT(1'bx)) g (.C(clk), .CE(1'b1), .R(btnC), .D(da[i]), .Q(acc[i]));"; want=PASS ;;
    alias)  ports=$clkd; body="logic [3:0] state; wire [3:0] alias_w; assign alias_w = state; always_ff @(posedge clk) state <= state + sw[3:0];
            assign led = {12'd0, alias_w};"
            fault="logic [3:0] state, d; wire [3:0] alias_w; assign alias_w = state; assign d = state + sw[3:0];
            for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(state[i])); assign led = {12'd0, alias_w};"; want=PASS ;;
    enum1sub) ports=$clkd
            pre="typedef enum logic {FOFF, FON} fs_t;
module blinker(input logic clk, input logic en, output logic on); typedef enum logic {OFF, ON} st_t; st_t s;
  always_ff @(posedge clk) if (en) begin if (s == OFF) s <= ON; else s <= OFF; end assign on = (s == ON); endmodule"
            npre="module blinker(input logic clk, input logic en, output logic on); logic s;
  FDRE #(.INIT(1'bx)) q (.C(clk), .CE(en), .R(1'b0), .D(~s), .Q(s)); assign on = s; endmodule"
            body="fs_t f; always_ff @(posedge clk) if (sw[1]) begin if (f == FOFF) f <= FON; else f <= FOFF; end
            blinker u_b (.clk(clk), .en(sw[0]), .on(led[0])); assign led[15:1] = {14'd0, f == FON};"
            fault="logic f; FDRE #(.INIT(1'bx)) g (.C(clk), .CE(sw[1]), .R(1'b0), .D(~f), .Q(f));
            blinker u_b (.clk(clk), .en(sw[0]), .on(led[0])); assign led[15:1] = {14'd0, f};"; want=PASS ;;
    enumstart) ports=$clkd; body="typedef enum logic [1:0] {A, B, C} st_t; st_t s;
            always_ff @(posedge clk) case (s) A: if (sw[0]) s <= B; B: s <= C; default: s <= A; endcase assign led = {14'd0, s};"
            fault="logic [1:0] s, d; assign d = s == 2'd0 ? {1'b0, sw[0]} : s == 2'd1 ? 2'd2 : 2'd0;
            for (genvar i = 0; i < 2; i++) FDRE #(.INIT(1'b1)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(s[i])); assign led = {14'd0, s};"; want=FAIL ;;
    memstart) ports=$clkd; body="logic [3:0] mem [0:15]; always_ff @(posedge clk) if (sw[15]) mem[sw[11:8]] <= sw[3:0]; assign led = {12'd0, mem[sw[7:4]]};"
            fault="for (genvar i = 0; i < 4; i++) RAM16X1D #(.INIT(16'hffff)) m (.WCLK(clk), .WE(sw[15]), .D(sw[i]), .A0(sw[8]), .A1(sw[9]), .A2(sw[10]), .A3(sw[11]),
              .DPRA0(sw[4]), .DPRA1(sw[5]), .DPRA2(sw[6]), .DPRA3(sw[7]), .SPO(), .DPO(led[i])); assign led[15:4] = '0;"; want=FAIL ;;
    datasw) ports=$clkd; body="logic [3:0] q = '0; always_ff @(posedge clk) q <= sw[3:0]; assign led = {15'd0, q == sw[3:0]};"
            fault="logic [3:0] q = '0; always_ff @(posedge clk) q <= sw[3:0]; assign led = 16'd1;"; want=FAIL ;;
    nobench) ports=$comb; nports='(input logic [15:0] sw, input logic extra, output logic [15:0] led);'
            body="assign led = sw;"; fault=$body; want=NOBENCH ;;
    pkgfile) ports=$comb; pkgf="package types_pkg; localparam logic [15:0] K = 16'h5a5a; endpackage"
            body="assign led = sw ^ types_pkg::K;"; fault="assign led = sw ^ 16'h5a5a;"; want=PASS ;;
    nothing) ports=$comb; body="assign led = 16'bz;"; fault="assign led = sw;"; want=NONE ;;
    romstart) ports=$clkd; body="logic [2:0] q; always_ff @(posedge clk) $cnt assign led = {sw[15:3], q};"
            fault="$ncnt assign led = {sw[15:3], b};"; want=PASS ;;
    mixstart) ports=$clkd; body="logic [2:0] q; always_ff @(posedge clk) $cnt assign led = {sw[15:3], q};"
            fault="$ncnt assign led = {sw[15:3], b[2:1], a[0]};"; want=FAIL ;;
    simflip) ports=$clkd; body="logic [1:0] sel; always_ff @(posedge clk) sel <= sel + 2'd1; $digit"
            fault="$nsel assign led = sel == 2'd1 ? 16'b1101 : sel == 2'd2 ? 16'b1011 : 16'b1111;"; want=FAIL ;;
    simlost) ports=$clkd; body="logic [1:0] sel; always_ff @(posedge clk) sel <= sel + 2'd1; $digit"
            fault="assign led = 16'b1111;"; want=FAIL ;;
    xhold)  ports=$btnd; body="logic [3:0] mem [0:15]; logic [3:0] q; always_ff @(posedge clk) q <= sw[3:0]; assign led = {sw[15:4], mem[q]};"
            fault="assign led = {sw[15:4], 4'bxxxx};"; want=FAIL ;;
    swreset) ports=$clkd; body=${fsm//btnC/sw[15]}
            fault="logic [2:0] h, d;   // recode's netlist, its reset on sw[15]
            assign d[0] = sw[15] | (h[0] & ~sw[0]) | (h[1] & ~sw[1]) | h[2];
            assign d[1] = ~sw[15] & h[0] & sw[0];
            assign d[2] = ~sw[15] & h[1] & sw[1];
            for (genvar i = 0; i < 3; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(1'b0), .D(d[i]), .Q(h[i]));
            assign led = {14'd0, h[2], h[0]};"; want=PASS ;;
    partassign) ports=$btnd; body="always_ff @(posedge clk) if (btnC) led[3:0] <= 4'd0; else led[3:0] <= led[3:0] + 4'd1; assign led[15:4] = sw[15:4];"
            fault="logic [3:0] d; assign d = led[3:0] + 4'd1;
            for (genvar i = 0; i < 4; i++) FDRE #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .R(btnC), .D(d[i]), .Q(led[i])); assign led[15:4] = sw[15:4];"; want=PASS ;;
    negset) ports=$clkd; body="logic a, b; wire pre = sw[13] & sw[12];
            always_ff @(negedge clk) if (sw[15] & sw[14]) a <= 1'b1; else a <= sw[0];
            always_ff @(negedge clk, posedge pre) if (pre) b <= 1'b1; else b <= sw[1];
            assign led = {14'd0, b, a};"
            fault="logic a, b; FDSE_1 #(.INIT(1'bx)) f (.C(clk), .CE(1'b1), .S(sw[15] & sw[14]), .D(sw[0]), .Q(a));
            FDPE_1 #(.INIT(1'bx)) g (.C(clk), .CE(1'b1), .PRE(sw[13] & sw[12]), .D(sw[1]), .Q(b)); assign led = {14'd0, b, a};"; want=PASS ;;
    *) sed -n '2,100s/^# \{0,1\}//p' "${BASH_SOURCE[0]}" | sed '/^set -euo/,$d' >&2; exit 2 ;;
esac
cd "$W"
printf '%s\nmodule top%s\n  %s\nendmodule\n' "$pre" "$ports" "$body" > rtl.sv
printf '%s\nmodule top%s\n  %s\nendmodule\n' "$npre" "${nports:-$ports}" "$fault" > net.v
# a package file sorts after rtl.sv, so eqv.sh has to put it first
[ -z "$pkgf" ] || printf '%s\n' "$pkgf" > types_pkg.sv
# the netlist as the product's arrives: JSON with the cell library as blackboxes. Then the runner's eqv.sh, in a
# folder that holds the RTL (rtl.sv; it leaves net.v out), as the netlist stage runs it
yosys -q -p "read_verilog -lib -nowb $CELLS; read_verilog -sv net.v; hierarchy -top top; proc; opt_clean -purge; write_json net.json"
rc=0; out=$("$HERE/eqv.sh" net.json 2>&1) || rc=$?
got=$(grep -E '^EQV (PASS|FAIL)' <<< "$out" || true)
echo "${got:-no EQV verdict}"
case $want in
    PASS) [ $rc -eq 0 ] && [[ $got == "EQV PASS: "* ]] ;;
    FAIL) [[ $got =~ ^EQV\ FAIL:\ [0-9]+\ of\ [0-9]+\ compared ]] ;;
    NOBENCH) [ $rc -eq 1 ] && [ "$got" = "EQV FAIL: the RTL compiles but the equivalence bench does not" ] ;;
    NONE) [ "$got" = "EQV FAIL: no output bit was ever known in both, nothing compared" ] ;;
esac || { grep -vE '^EQV (PASS|FAIL)' <<< "$out" | tail -5 >&2; exit 1; }
