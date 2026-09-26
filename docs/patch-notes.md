# Patch notes

## 1.2 (in progress, from 24 September 2026)

Every update below comes with the tests that prove it: what each test checks, and the numbers before and after.

### #1 · The CLI and the guide say the same thing · 24 September

**`dewfpga uninstall` says what it removes, and removes only its own.** It used to print
`removing: ~/fpga ~/.dewfpga <link>` and then delete five entries inside `~/fpga`, not the folder.
It also deleted Homebrew's `dewfpga` link even when that link pointed to another copy of the CLI.
Now it lists every path it deletes, touches the link only when the link points to itself, leaves
anything else in `~/fpga` alone, and says `nothing to remove` when there is nothing.
Tried on a fake install with a student project inside `~/fpga`: the project file survived, the real
Homebrew link survived, a second run printed `nothing to remove`, and an empty folder was removed.

**Version 1.2.0.** The CLI had said 0.1.0 since 19 September. The patch number and
`dewfpga --version` are now the same number.

**The guide stopped contradicting itself.**
- Section 2 said two course-code problems "are handled for you". Only one is (the seven-segment
  port line); the others stop the build with the line and the fix.
- Section 7 said "one", then "two more", then listed six cases.
- Section 8 called it "the one case hit so far".
- The command list had no `--version`.

Tried: writing the right count into section 7. Dropped it, because the list grows every time a new
student repo turns up a new case. The text now says what each case does instead of how many there are.
The HTML page and the PDF (12 pages) were rebuilt from the same source.

**README.tr described rules that stopped being true on 21 September.** It said the top module is
chosen by its `.xdc` file, `sim` needs `<top>_tb.sv`, two `.sv` files in one folder is an error, and
`dewfpga check` has six rows. The top now comes from the module hierarchy, the testbench is
recognized by its content, file names are free, and `check` prints nine rows.
README.tr is now a translation of the English README.

**Disk space, measured.**
- After the one-line install, `~/fpga` holds 1.40 GB: nextpnr-xilinx 1.06 GB, prjxray 214 MB,
  the chip database 89 MB, the Python venv 52 MB.
- Homebrew packages add 235 MB.
- The home page said 1.76 GB, which is the by-hand path with full git clones.
- The home, why and Turkish pages now say 1.4 GB (1.76 GB by hand).

**Tests.** `test/run.sh`: 51 passed, 0 failed before the change (81 s) and 51 passed, 0 failed
after. One test was renamed: "top found from xdc" is now "top found from the hierarchy", which is
what it has checked since 21 September.

**Not done here.** The README still says "46 checks"; update #6 locks that number to the test suite.

### #2 · 132 SystemVerilog probes run through the product, every stage checked · 25–26 September

**In numbers.** Before #2, `test/run.sh` passed 51 checks, and the 43 probes of the 2509 measurement lived
outside the repo, run by a script that called yosys directly (33 of 43 synthesized). After: `test/run.sh`
passes 178, fails 0, and counts 87 known gaps apart; its probe section runs 132 probes through the CLI
itself. Synthesis 69/132, all four stages 30/132, and 29 of the 111 probes Vivado supports pass all four:
the other 82 are our gap. 17 probes build a bitstream whose netlist fails: 15 do something else (a silent
wrong), and 2 (`35`, an MMCM, and `97`, a block RAM) have no simulation model to check them against. The
product did not change in #2 (`bin/` and `templates/` are the same as before); #3 and #4 are scored
against these numbers. Seven break rounds sent 195 reports; every one was reproduced (one of round 7's in
part), seven side claims inside them did not hold (below), and what was not fixed here is listed with the
update that owns it. Every probe, with its construct, Vivado's status, the source and the stage that fails, is listed under
"Every probe" below.

**What a student may write is now part of the test suite.** `test/sv/` holds 132 probes, one construct
each: `design.sv` (one probe has `design.v`) with `module top`, `tb.sv` with `module tb` that prints
`PASS`, sometimes a `.svh`, a `.mem`, a package, interface, submodule or netlist-form module in its own
`.sv`, or the lab's own `Basys3_Master.xdc` with only some pins uncommented (`96b`; `93`'s one design file
is `counter.sv`, as its lab has it). 43 came from the 2509 measurement (`svprobe`); the comments that named
a student and a student's file are gone. 8 were added in the first break round, 18 in the second, 23 in
the third, 8 in the fourth, 15 in the fifth, 8 in the sixth and 9 in the seventh (below), for cases the 43
did not cover. Every probe goes
through four stages, all of them through `bin/dewfpga` and `templates/Makefile`, in a temp folder that
holds only the probe's sources:
- **rtl**: `dewfpga sim`. Pass = exit 0 and the testbench printed `PASS`.
- **synth**: `dewfpga bit`, with the whole `Basys3_Master.xdc` uncommented as in a lab folder. Pass = the
  product wrote `top.json`, or the netlist of another module when the CLI took that one for the top
  (round 4: `81`); the stages then check what it built, and the row's note names it.
- **netlist**: that netlist written back as Verilog (`read_json`, `write_verilog`). Pass = both:
  - the same `tb.sv`, simulated on the netlist with yosys' `xilinx/cells_sim.v`, prints `PASS`;
  - the netlist matches the RTL (`test/sv/eqv.py`): both get the same inputs, every combination (all
    zeros included) when the design has 16 input bits or fewer, buttons included, and no clock; otherwise
    4096 random cycles, each one all zeros, all ones, mostly zeros, mostly ones or even odds, with the
    buttons pressed one cycle in eight. Every output bit the RTL knows has to be equal; an `x` or a `z` in
    the netlist is not equal. Both start as the board does: a register without a start value gets its
    primitive's default in the netlist (0, or 1 for FDSE and FDPE, as nextpnr writes them) and the same
    value in the RTL, and with a clock and buttons every button is held for one clock edge before the
    first compare, as a student presses reset after loading the board (round 4; round 3 counted such
    differences apart instead, which let a lost reset through); since round 7 so is every input bit
    that resets a register (`sw[15]` in `if (sw[15]) s <= IDLE`). The run also passes when the netlist
    follows, at every compare, a second copy of the RTL started as `dewfpga sim` starts it, `x` where
    it gives no start value: equal to the board's start while a register bit of that copy is still
    `x`, and to that copy, every bit known, once none is. The board then shows what the student's own
    simulation shows (round 6: a register yosys moves into a ROM can start the board one clock off the
    usual 0; round 7 made this one decision for the whole run, not one per compare). When iverilog
    cannot compile the RTL
    (`13d`, `18b`, `18c`, `21b`, `22`, `38`, `54`, `55`, `71`, `72`, `73` today) this half is skipped and the
    result line says so. `test/sv/eqv.sh` runs this half, and `test/sv/eqv_check.sh` runs the same `eqv.sh`
    on netlists that differ from their RTL in one known way (round 5; until then it kept its own copy of
    the RTL side).

  This stage checks what synthesis made. It does not check place-and-route or the bitstream.
- **bit**: the same `dewfpga bit` exits 0 and writes the netlist's `.bit` (`top.bit`).

`test/sv/expect.tsv` has one row per probe: the construct, whether Vivado accepts it, the source for that,
what each stage does today, and what the student sees. `test/sv/run.sh` fails on any difference, in both
directions: a stage that stops passing, and a stage that starts passing without the table saying so. It
also fails on a row without a source, on a `file:line` in the today column that no stage printed, and on a
message the today column quotes (`'...'` or `"..."`) that no stage printed word for word (round 4). It
prints four numbers: synthesis, all four stages, Vivado-supported probes that pass all four, and known
gaps. A known gap does what the table says, but either Vivado supports it and a stage fails, or its
bitstream builds while its netlist fails (a silent wrong).

`test/run.sh` runs it and prints one line per probe: `PASS`, `GAP` (counted on its own, not as a pass;
it does not fail the run) or `FAIL`. A probe that fails where Vivado refuses the code, or where what
Vivado does is unverified, is a `PASS`, unless its bitstream builds from a netlist that fails: that
silent wrong is a `GAP` whatever Vivado does (`03`, `03b`, `05` and `39` are unverified and gaps; this
said `PASS` until round 5, and so did `test/run.sh`'s header). CI runs the same and keeps the rows as the
`sv-results` artifact.
With the measured yosys and iverilog, when #3 or #4 closes a gap the run fails until `expect.tsv` records
the new result, so every change in these numbers is an edit of the table. With another yosys (CI installs
0.68+post) a stage that starts passing is only a note, so the table is updated from a local run.

**Found on the way: the CLI's top finder misses an array of instances.** `inv u_inv [3:0] (...)` is in
UG901's list of supported Verilog, and it compiles through the CLI. What fails is the automatic top: the
scanner does not read `inv u_inv [3:0] (` as an instance, so `inv` looks like a second top, and
`dewfpga bit` prints `2 modules could be the top (nothing instantiates them): inv, top. Name it:  dewfpga
bit inv`, which names the wrong one. `dewfpga bit top` builds it (4 LUT), and so does plain `dewfpga bit`
when the file is named `top.sv`. The old runner called yosys directly and never saw this, so synthesis
through the product is 32/43, not the 33/43 the plan started from. The fix is #4's.

**The Vivado column, checked row by row.** Sources: UG901 v2023.2 (chapter, table, page), UG953 v2022.2
(the 7-series primitive guide), and Vivado logs from public CS223 lab repos. A quoted log line keeps the
message; the student's module and signal names are replaced by a description. A forum is marked as a weak
source. The 132: 111 supported, 3 not supported, 18 unverified (the 123 of round 6: 105, 3, 15; the
115 of round 5: 99, 3, 13; the 100 of round 4: 84, 3, 13). Changes
from the 2509 measurement:
- `35_mmcm`: unverified → supported. UG953 p.459, MMCME2_BASE: "Instantiation: Yes".
- `37_var_init`: supported → unverified. The declaration initializer is documented (UG901 p.244). For
  `initial c2 = 9`, UG901 contradicts itself: p.251 says "initial blocks are ignored during synthesis",
  p.155 initializes a RAM inside an `initial` loop.
- `33`, `33b` (inout read-back): UG953 p.386, IOBUF "Inference: Recommended", added next to UG901
  Tristates, which only covers output buffers.
- `32` (a derived clock): a Vivado 2020.1 lab log where a toggled register clocks another module, 0
  errors, bitstream written.
- The 2509 notes used v2022.2 chapter numbers next to v2023.2 tables; all cites are now v2023.2.
- `42_streaming_concat`: supported → not supported (round 3): its `{<<{...}}` is the "Re-ordering of the
  generic stream: Not Supported" row (p.287), not the "Concatenation of stream_expressions" row above it.
- Still unverified: `03`, `03b` (async load), `04` (both clock edges), `05` (two drivers), `37` (above), and
  of the new ones `39` (an undeclared name; IEEE 1800 makes it an error), `55` (a conditional between two
  values of one enum), and from round 3 `46` (`continue`), `48` (`iff`), `66` (`alias`), `77` (an
  `initial` that reads a signal) and `80` (a statement after an async reset's if/else), from round 4
  `63` (a cast of a real parameter, below), from round 6 `37b` and `63b`, and from round 7 `95` (a module
  with ports and no body), `98` (a module named `INV`) and `99` (a parameter of type `string`). The only sources
  for 04 and 05 are forum posts. `13b` (an unpacked array port) was unverified until the second break
  round found UG901's own examples of it; it is supported now.

**Tried, and why it changed.**
- Calling yosys directly with the Makefile's script, as the old runner did. Dropped: it hid the top
  finder's miss on `26`, and it would not measure #3 and #4, which change the product.
- Uncommenting `create_clock` too. A probe without a `clk` port then prints `create_clock: target
  [get_ports clk] matched nothing`. It stays commented; timing is checked at 100 MHz, as for any lab
  without one.
- Bash 3.2 (macOS's `/bin/bash`) has no `mapfile` and fails on empty arrays under `set -u`; the runner
  uses neither.
- The netlist of `03b` never reaches `$finish`; it used to show as "(no output)". It now says `TIMEOUT`.
- CI installs yosys 0.68+post, while `expect.tsv` is measured with 0.69+post. With the measured yosys and
  iverilog, every difference fails. With other versions, a stage that used to pass and now fails counts,
  and so does a new silent wrong; a new pass is printed as a note, because students get whatever brew
  ships. Before pushing, all 51 were run with yosys 0.68 (YoWASP, in a scratch venv, brew untouched): the
  same 51 results.

**Break round 1.** Three independent breakers (a student who writes what Vivado accepts, a mutation
tester, a regression reader) ran against #2 and sent 38 reports; some are the same break seen by two or
three of them. Every one was reproduced in a scratch folder. Two side claims inside them did not hold as
written: one breaker counted 20 probes hidden behind `passed 94`, and the table has 18 (43 minus the 25
that passed all four; 13 of them Vivado-supported, as the breaker said); another's aside, that CI's golden
check would also miss every LUT INIT zeroed before nextpnr, came from reading `test/run.sh`, and it was not
run under CI's yosys 0.68 (not verified). What changed:
- **The netlist stage passed wrong netlists.** With one to four vectors per testbench, 142 of the
  breaker's 174 single-bit LUT INIT flips in the product's own netlists passed. The netlist is now also
  compared with the RTL (`eqv.py`, above): 204 of 228 such draws were caught (some draws were the same
  flip; round 2 measured distinct flips, under "Does the suite catch breakage?").
- **Testbenches did not look at the construct they name.** `30` passed with `>>>` read as `>>` and with
  `$signed` dropped, `19` with a casez item deleted, `18` could not tell `1???` from `10??`, and `17`'s
  size cast could be dropped because the output cut the value anyway. `17`, `18`, `19` and `30` now check
  every input combination they use against a reference written in plain integers; `30` shows the sign
  that `>>>` copies in (`seg[6] = sh[7]`), and `17` shifts after the cast so the cast shows. The same sweep
  found `10`'s DONE state and `32`'s hex table half unchecked; both testbenches now walk every state and
  every digit, and `18b` and `22` (where only the testbench checks the netlist) check every combination.
  Source mutations over the 43 (one operator at a time, iverilog): 113 killed and 42 survived before,
  122 killed and 32 survived after. The 32 left are equivalent (a 1-bit counter's `+1` and `-1`, widths
  the output cuts anyway, a `generate` branch that is never built, a case item that repeats the
  default), clock-edge swaps and reset phases a testbench cannot see, `led` bits no testbench reads, and
  one logic change its vectors miss (`36`'s `sw[0] & sw[1]` as `|`). A reader fault in any of those
  outputs would still show in the netlist stage, where `eqv.py` compares every output bit.
- **Silent wrongs had no probe, and one was new.** `39_undeclared_name`: `summ` for `sum` builds a
  0-LUT bitstream with exit 0 (the plan's #3 lists it; the table had no row). `23c_package_own_file`:
  the CLI hands the tools only the files that hold a module, so a package in its own file is left out,
  yosys makes `cfg_pkg::MAGIC` an undriven implicit wire, and the bitstream builds with 0 LUT. `eqv.py`
  found a fifth: `03`'s async load. While `btnC` is held, the netlist follows `sw` and the RTL keeps the
  value from the edge, so the board does not do what the simulation showed.
- **Constructs Vivado accepts that the 43 did not cover**, now probes with their sources: `38` gate
  primitives driving `logic` (a Vivado 2015.2 lab log builds it; iverilog 13 refuses it), `16c` UG901's
  own while-loop example (yosys refuses it), `22b` an interface in its own file (iverilog stops at the
  interface port, and the CLI leaves `sum_if.sv` out of synthesis, so yosys does not find the interface),
  `23d` an import in the module header (the CLI refuses it before any tool runs), `40` a module named
  `display` next to a `$display` call (the CLI reads it as an unnamed instance), `13b` an unpacked array
  port (yosys refuses it; Vivado support found in round 2).
- **The runner could be fooled.** It copied build outputs left in a probe folder with fresh times, so
  `make` reused a stale `top_sim`; it now copies only sources. With a yosys other than the measured one
  (CI's 0.68), a probe that turned into a silent wrong was only a note; that now fails in every mode. A
  row with an empty source went through; it is now refused. The table said "the CLI names the line" and
  nothing checked it; a `file:line` in the today column now has to appear in the stage logs, so a latch
  error moved to line 1 fails `01`.
- **`test/run.sh` counted known gaps as passes**: `passed 94` included 18 probes that fail a stage as
  recorded, 13 of them Vivado-supported. They are now `GAP` lines, counted apart.
- **Hygiene.** The personal-path check excluded every file named `run.sh`, so it never read
  `test/sv/run.sh`; it now excludes only `test/run.sh` itself. `expect.tsv` quoted four module and signal
  names from one student's Vivado logs, two of them found in only one repo of the 94; the quotes keep
  the log message and describe the name instead, and a check refuses a quoted `module '<name>'` again.
  `SV_OUT=rows.tsv` (a relative path) wrote into the temp folder and was deleted; it is now made absolute
  before the tests `cd` anywhere.
- **The notes were wrong in five places**, corrected above and below: `-g2005` did not turn only `09`
  and `10` red; the netlist stage does not see the bitstream; the array-of-instances quote was
  paraphrased and the construct does build with `dewfpga bit top`; "no UNISIM models" was given as the
  reason for `18b` and `22`; "these numbers move on their own" contradicted the runner. `35`'s UG901 page
  is 232, not 231. `CLAUDE.md` said the suite has 51 tests.

Tried, and dropped:
- Comparing netlist `x` with a known RTL bit as a mismatch: an uninitialized flip-flop in the netlist
  model is `x` where the RTL has a 2-state `int` at 0 (`10`), and the board starts at 0. An `x` there was
  counted apart and a `z` still counted. Round 3 found that this let an undriven output through, and
  changed it (below).
- Changing all inputs at once in the equivalence bench: `09`'s latch got its gate and data in the same
  instant, a race in any simulator, and showed a false mismatch. Then a random walk of one bit per cycle:
  no race, but `29`'s shift register saw almost only runs of equal bits, and 4 of 12 LUT flips survived.
  Now every bit gets a new random value each cycle, one bit at a time: 20 of 20 in a new sample.
- Decoding the bitstream back to FASM (prjxray's `bit2fasm`) to check the bit stage: it needs `bitread`,
  which `install.sh` does not build, and a frames-to-FASM decode of `30` gave 195 missing and 1939 extra
  features next to nextpnr's FASM (default bits and pseudo-pips), so it is no quick check. A test that
  looks inside the bitstream is left to #6. Until then, place-and-route and bitstream writing are
  checked only by `test/run.sh`'s golden blink FASM, and exactly only with the yosys it was made with.
- A probe for a design and its testbench in one file, and one for two testbenches in one folder: the
  runner keeps the testbench in `tb.sv`, so neither fits a probe; they are left with their fixes (below).

Found and left to later updates (reproduced, not fixed here):
- #3: editing a `.mem` file does not rebuild (`$(TOP).json` does not depend on it), so `dewfpga bit` says
  "up to date" and the board gets the old ROM.
- #4: gate primitives on `logic` in sim; a package or an interface in its own file (and the README and
  cli page sentence "Every .sv/.v in the folder is synthesized", false for them; round 4 made it say what
  happens); an import in the module
  header; a module named `display`; a design and its testbench in one file (sim: "already declared",
  bit: yosys reads the testbench); while loops; unpacked array ports; the unnamed-instance errors come
  out in a different order from run to run (a Python set).
- #5: `04` and an async reset with a synchronous clear in one `always_ff` get "a signal is written from two
  always blocks" with no file:line.
- #6: a test that looks inside the bitstream.
- #12: two testbenches in one folder; `sim` always runs the first, with no way to pick the other.

**Break round 2.** The same three kinds of breaker ran against the tree after round 1 and sent 30
reports; two of them are the same break (`13b`). Each was run in a scratch folder: all 30 reproduced.
Fixed here:
- **`13b`'s Vivado column was wrong.** UG901's own 3D RAM examples declare unpacked array ports:
  `rams_sp_3d.sv` (p.161) has `input [A_WID-1:0] addr [NUM_RAMS-1:0]` and `output reg [D_WID-1:0] dout
  [NUM_RAMS-1:0]`, the dual-port ones (p.162, p.164) the same, and so does v2022.2. `dewfpga bit` on
  UG901's file stops at `rams_sp_3d.sv:10: ERROR: syntax error, unexpected '['`, and `test/run.sh` printed
  `PASS` for it. `13b` is supported now, so a known gap.
- **Vivado accepts 18 more things we fail, and no probe had them.** Each is a probe now, with its source.
  (Round 3 read the sources again: `42` is not supported and `46`, `48` and `55` are unverified, so 14 of
  these 18 count as Vivado-supported now.)
  - UG901 v2023.2 Table 27 marks these Supported, and yosys refuses each at synthesis: `41` `==?`, `42`
    `{<<{...}}`, `43` `foreach`, `44` `do ... while`, `47` a type parameter, `48` `@(posedge clk iff en)`,
    `49` a default argument, `50` arguments by name, `51` an unpacked array `localparam` set with `'{...}`.
    `45` `break` and `46` `continue` are "Jump statements: Not Recommended", the reading `16b` uses for
    `return`. iverilog refuses `42`, `48` and `51` too.
  - `52` an internal tristate bus, the textbook's mux from two tristate buffers. UG901 p.86: "An inferred
    BUFT is converted automatically to logic realized in LUTs". yosys keeps two `$_TBUF_` cells, nextpnr
    has no place for them, and the CLI says "the design does not fit the XC7A35T ... Make it smaller" for
    four muxes. It was then the only probe whose synthesis passes and bitstream fails; round 3 added `70`
    and `75`, which do too.
  - `53` an async reset ORed with a synchronous clear, `always_ff @(posedge clk, posedge btnC) if (btnC ||
    btnU)`: a Vivado 2021.2 lab log builds it; yosys stops ("Multiple edge sensitive events").
  - `54` a name used before its declaration: in the course's own example project, Vivado's simulator
    warns ("VRFC 10-756 ... used before its declaration") and builds; `dewfpga sim` refuses it,
    `dewfpga bit` builds it.
  - `56` a file-scope `typedef enum {S0, S1, S2}`: `S0` collides with a name in yosys' own
    `xilinx/cells_sim.v`, and the only location printed is that yosys file. Inside the module, or named
    `IDLE`/`RUN`/`DONE`, it builds.
  - `57` a course "ready module" in the netlist form the course hands out (`(* keep_hierarchy *)`,
    `\<const0>`, LUT primitives): Vivado 2017.3 builds the course's own example project with two of
    them; the CLI calls the file a leftover Vivado netlist and says to delete it. yosys given the files
    builds it. Of the 7 corpus lab folders the CLI refuses as netlists, 5 hold such course modules (round
    5: 4 of the 5 are one repo's copy of the course's handout folder, 1 is a student's project with the
    modules copied in).
  - `08b` the course's port line with comments in the port list (one after `seg,`, one holding a `;`):
    the port-line fix misses it and yosys stops with "Module port `\dp' is neither input nor output".
  - `55` a conditional between two values of one enum (`next = sw[0] ? RUN : IDLE`): iverilog wants a
    cast, yosys builds it, slang accepts it. What Vivado does is unverified.

  Every new testbench was run twice: it passes on a correct implementation (iverilog on the RTL, or,
  where iverilog refuses, a netlist from yosys-slang or yosys) and fails on the design with its
  construct broken (one edit each, 18 of 18 caught).
- **`eqv.py` never compared the all-zero input.** Its Gray-code walk ran `i = 1 .. 2^n`, so `sw = 0000`
  never came up (and `2^n` truncated to a repeat). A netlist wrong only at `sw = 0000` passed with
  "1048576 output bits compared". The walk starts at 0 now.
- **`eqv.py` missed faults at corner values.** Random cycles drew even odds per bit, so `sw = ffff` came
  up once in 65536 cycles. The breaker's flip in `21`'s popcount LUT (wrong only at `sw = ffff`) passed
  4096 cycles; a second flip, wrong at `sw = 7fff`, too. Each random cycle now picks all zeros, all
  ones, one bit in eight, seven in eight, or even odds; both flips are caught.
- **Buttons turned the exhaustive walk off**, which the notes did not say. Without a clock the walk
  changes one bit at a time anyway, so buttons join it (only `05` has buttons and no clock).
- **`eqv.py` could be gutted with every test green** (compare only bit 0, or run 16 cycles), and the
  round-1 "204 of 228" was a one-off measurement. `test/sv/eqv_check.sh` now runs six netlists that
  differ from their RTL in one known way: equal (has to pass), only `led[15]`, only at `sw = 0000`, a
  clocked design only at `sw = ffff`, only at `sw = 7fff`, and a counter only after 200 cycles.
  `test/run.sh` runs all six.
- **`test/run.sh` trusted the runner's verdict and ignored its exit code.** A runner that wrote `ok` for
  a failing probe, or a consumer that filed `bad` as a gap, left the suite green over a real regression
  (`14`'s parameterized instance hidden from the top finder: `PASS sv 14_params`, exit 0). Now each
  row's verdict is worked out again from `expect.tsv` and the row's four stages and has to match; the
  runner's exit code has to fit its rows; its known-gap count has to equal the rows'.
- **Runner guards that no test pinned**, each now pinned by a check that breaks it on a copy:
  - a testbench that prints `FAIL` (dewfpga sim still exits 0) has to be an rtl fail (`16c` broken on
    purpose);
  - a probe folder without a row has to be refused;
  - a `dewfpga bit` that exits 0 without `top.bit` has to be a bit fail;
  - synth is read from `top.json`, not the exit code: `52` pins it (synth passes, bit fails);
  - a silent wrong of an unverified probe (`03`, `03b`, `05`, `39`) has to stay a gap: the re-derived
    verdict above pins it.
- **The vivado column was not checked against its source.** Changing `01` to `not supported` turned its
  gap into a pass. The runner now refuses a row whose column its source does not back: `not supported`
  needs UG901's "...: Not Supported'" or invalid code, `unverified` needs the reason no source settles it
  ("does not say what Vivado does", "is not described", "Weak source only", "No Vivado log",
  "contradicts itself"), and `supported` has neither. Tried on 9 column-only edits (`01` both ways,
  `22b`, `23b`, `05`, `20`, `18`, `06`, `13b`): all 9 refused.
- **The student-name check had no self-test**, and only knew quoted `module 'x'` forms. It is now a
  function over the source column (the today column names the probes' own modules), it also sees
  `` `\name' `` quotes and Vivado's `(name_reg)`, and a check plants both and has to find them.
- **`expect.tsv` said `03` and `05` build "with no warning".** Both print yosys warnings (`Async reset
  value ... is not constant!`, `Driver-driver conflict ... Resolved using constant.`) and exit 0. Fixed.
- **The notes were wrong**: `22b` is not refused "before any tool runs" (iverilog and yosys both run);
  the LUT-flip counts drew flips with replacement and the survivor list added up to 23, not 24 (now
  measured again, below). `CLAUDE.md`'s corpus line said none of the 73 failing folders was the CLI's
  fault; 17 are Vivado-accepted code we refuse, and 5 of the netlist folders are course modules.

Tried, and dropped:
- Checking new testbenches on slang netlists only: slang refuses `44` ("unsupported language feature"),
  `53` ("condition cannot be matched to any signal from the event list"), `54` (it enforces declaration
  before use) and `57` (no cell library), and its netlist of `52` leaves the bus `x`. Those were checked
  on iverilog or yosys instead.
- Re-deriving the verdict in `test/run.sh` alone: the runner's own verdict was then still unpinned (a
  runner that writes `ok` for `bad` went unnoticed, because the consumer caught the probe anyway). The
  row check now also needs the runner's row to say `bad`. A separate branch for "stages differ" turned
  out to duplicate the verdict comparison (breaking it changed nothing); the two are one branch now.
- A keyword check for `supported` rows: their sources share no phrase (Table 27 rows, coding examples,
  attribute pages, logs), so only the two directions that hide a gap are checked.
- A probe for a module defined in two files, and for a rebuild after a file is deleted or an included
  `.v` changes: the runner copies each probe into a fresh folder, so no probe can see a rebuild. They go
  to #3 with their fix and its test.
- A probe for CRLF line endings: no stage looks at line endings. Left to #4 with the port-line fix.

Found and left to later updates (reproduced, not fixed here):
- #3: a module defined in two files: the scanner keeps the last file that defines it, so a backup
  (`lab4_old.sv`) is built instead of `lab4.sv` (0 LUT, exit 0), and `dewfpga sim` compiles the backup;
  3 of the 89 corpus lab folders define a module in both a `.sv` and a `.v` file (a fourth does it in a
  Vivado netlist, which the CLI already refuses). `dewfpga sim` and `bit` do not rebuild when a file is
  deleted or swapped (a deleted testbench keeps running) or when an `include`d `.v` changes (`bit` says
  "up to date"): the same class as round 1's `.mem`.
- #4: the 18 new constructs, `13b`, and in sim `54` and `55`; the port-line fix with comments (`08b`);
  `--fix-ports` rewrites every CRLF line ending of the file it fixes (15 of the 364 corpus `.sv`/`.v`
  files are CRLF); the course's netlist-form modules refused as leftovers (`57`).
- #5: `52`'s "does not fit ... Make it smaller" for `$_TBUF_` cells; `53`'s "two always blocks"
  advice for one always block. The guide's section 7 says the async-load reset and the dual-edge cases
  "both stop with the line and the fix" (`03` builds with warnings, `04` has no file:line), quotes a
  netlist message ("take the original .sv") the CLI does not print, and section 8 says section 7
  "lists the cases hit so far" (it lists 5; the probes record 37 Vivado-supported failures). #3 turns
  `03` into an error; the catalog is #5's.
- #6: the pnr line prints a garbled clock name when the net's name has a `:` in it (`03`: `416:
  emulate_split_set_clr$1652.C': 338.98 MHz`).

**Break round 3.** The same three kinds of breaker ran against the tree after round 2 and sent 25
reports. Each was run in a scratch folder: all 25 reproduced. Fixed here:
- **Vivado accepts 20 more things, and no probe had them.** Each is a probe now (`58` to `80`), with its
  source. Every new testbench passes on a correct design (iverilog on the RTL, or, where iverilog refuses
  it, a hand-written equivalent) and fails on the design with its construct broken (28 edits, 28 caught).
  - Two new silent wrongs. `58` a hierarchical name, `assign led[1:0] = u_fsm.state;` (UG901 Table 20
    p.239, Table 27 p.288: Supported): yosys makes `u_fsm.state` a 1-bit implicit wire with no driver, so
    `led[1]` is a constant 0 and `led[0]` is undriven, and the bitstream builds (exit 0) while `dewfpga sim`
    shows the state. (This said "with the state LEDs dark" until round 4; what an undriven LED shows was
    not measured.) `59`
    `$isunknown(sw)` (Table 21 p.240): yosys makes it the constant 1, so the LED is lit for every input.
  - UG901 rows marked Supported that yosys refuses at synthesis: `60` pass by reference, `61` enum ranges
    (`{S[3]}`, `{T[5:7]}`), `62` the type operator, `63` `int'(STEP)` of a real parameter, `64` an unpacked
    struct, `65` a streaming concatenation as the target (`{>>{a, b}} = sw[7:0]`), `67` `==` on two
    unpacked arrays, `68` an unpacked array slice, `69` `disable` of a named block. iverilog refuses `60`,
    `62`, `64`, `65`, `67` and `68` too.
  - `70` a `wor` and a `wand` net: the netlist is right, but nextpnr has no place for yosys' `$and` and
    `$or` cells, and the CLI says the design "does not fit the XC7A35T ... Make it smaller", the same
    false diagnosis as `52`.
  - `71` a whole unpacked array assigned in `always_ff`, `72` a void function with output arguments, `73`
    an unpacked array as a function argument: yosys builds them right, iverilog 13 refuses them, so
    `dewfpga sim` fails.
  - `74` a `.v` file that uses `bit` and `final` as names. UG901 p.269: Vivado compiles `*.v` as Verilog
    2005 and `*.sv` as SystemVerilog. The CLI reads every file as SystemVerilog, so both sim and bit stop.
    0 of the 13 corpus `.v` files use such a name.
  - `75` a design that misses 100 MHz (a 14-bit value turned into four registered decimal digits: 33.61
    MHz). A Vivado 2015.2 lab log in the corpus routes at WNS -20.758 ns, prints a critical warning
    ("The design failed to meet the timing requirements") and writes the bitstream. The CLI stops with
    "timing not met ... no bitstream written", which is the recorded decision in `CLAUDE.md` ("timing
    FAIL = hata"). The probe records the difference; which rule wins is the owner's call.
  - `76` implicit nets the standard allows, from a port connection and from the left of an `assign`.
    They build today, with warnings, and a Vivado 2021.2 log of a public CS-224 repo builds one. #3 plans
    `-noautowire` for `39`; with it, `22`, `22b`, `22c`, `22d`, `22f`, `23c`, `39`, `58` and `76` stop
    at synthesis (round 6: a sweep of all 123 probes, each read with and without it; this list named 6
    of them until then). For `22c`, `22d`, `22f`, `39` and `58` that is the change wanted, a silent
    wrong becomes an error; `23c` and `22b` need #4's file fix anyway; `76` (legal implicit nets) and
    `22` (plain modports, which build right today) are there to keep legal code building.
  - `78` UG901's own `(* keep_hierarchy = "yes" *)` (p.60): the CLI's netlist detector matches that text
    and tells the student to delete their design. `79` the same attribute without spaces builds.
  - Unverified in Vivado, patterns from the corpus: `66` `alias` (UG901 p.286 lists both "Aliases:
    Supported" and "Net aliasing: Not Supported"), `77` `initial num = sw;` (a Lab 5 file; yosys stops
    with no file:line), `80` a statement after the reset's if/else in an `always_ff` with an asynchronous
    reset (a Lab 5 folder).
- **The Makefile's async-reset rule is live.** The plan calls it dead code on yosys 0.69 and #5 is set to
  delete it. `80` triggers it on yosys 0.69+post ("Async reset \btnC yields non-constant value", then the
  rule's advice), and so does one corpus lab folder. Its advice does not fit that case (the reset branch
  assigns only `q`); that text is #5's.
- **The equivalence bench let an undriven output through.** It counted an `x` in the netlist apart, to
  excuse flip-flops without a start value, and yosys writes an undriven output as `OBUF` with `.I(1'hx)`.
  The breaker's netlist with `led[4]` undriven printed `EQV PASS: ... (65536 more were x in the netlist
  only)`. Now:
  - `eqv.py --netlist` starts the netlist as the board does: an INIT that is x gets what nextpnr-xilinx
    writes (its `xilinx/fasm.cc`: FDRE, FDCE, LDCE and LDPE start at 0, FDSE and FDPE at 1, and an x bit
    of any other INIT is 0; this said LDPE at 1 until round 4, which the code does not say);
  - an `x` or a `z` in the netlist where the RTL knows the value is a mismatch;
  - the RTL starts a register without a start value at `x`, and a `case` on an `x` takes its default
    branch: `32`'s digit select gave `an = 0111` in the RTL and `1110` on the board until the reset. A
    third copy of the netlist, with its INITs left x, told these apart: a difference where that copy is
    `x` was counted on its own. Only `32` had any (2 bits). Round 4 found that this excused every
    difference of a netlist that never resets, and replaced it.
  - The breaker's netlist now gives `EQV MISMATCH ... led[4] rtl 0, netlist x`.
- **A submodule yosys kept broke the bench.** The netlist's `module inv` (kept for `keep_hierarchy`)
  clashed with the RTL's `inv`. `eqv.py --netlist` renames every design module of the netlist and the
  cells that instantiate them. `79` pins it: `BAD ... 'inv' has already been declared in this scope` on
  the round-2 tree, `ok` now.
- **`eqv_check.sh` did not pin what the notes promise.** Removing the exhaustive walk, the mostly-zeros
  values or the button presses, or counting a `z` as unknown, left all six cases green. It now has 15
  cases (new: `walk` a fault only at `sw=1234`, `sparse` only at `sw=0100`, `button` only while `btnC` is
  pressed, `zout`, `xout`, `init`, `xstart`, `hier`, `hierfault`), and every netlist goes through `eqv.py
  --netlist` as the product's does. 16 mutations of `eqv.py` each turn at least one case red (list
  below).
- **In CI's mode the netlist stage could be emptied.** With a yosys other than the measured one, a stage
  that starts passing is only a note, so deleting the netlist-vs-RTL comparison left the suite green (`03`
  became a note). Two runner checks now run in that mode, each on a design whose netlist differs from its
  RTL (`` `ifdef SYNTHESIS ``, which yosys defines and iverilog does not): `07` with a testbench that sees
  nothing, so only the comparison can catch it, and `54`, whose RTL iverilog cannot compile, so only the
  testbench's `FAIL` on the netlist can. Deleting the comparison turns the first red; dropping the check
  for the testbench's `PASS` turns the second red.
- **CI's step summary got 8 score lines.** The runner checks' broken copies wrote theirs too. They now run
  without `GITHUB_STEP_SUMMARY` and `SV_OUT`, and a check fails if one of them writes a summary (`FAIL` on
  the round-2 tree, `PASS` now). The final run writes one line.
- **`08`'s port-line note could name the wrong line** with every test green: its today column was `-`. It
  now quotes `design.sv:2`, so the note moved to line 3 fails `08` (`expect.tsv says design.sv:2, no
  stage printed it`).
- **`55`'s testbench missed 23 of the 36 LUT flips that change what its netlist does** (every one of its
  48 LUT bits flipped; "changes" = the netlist stage's bench sees a difference against the unflipped
  netlist). It now goes through every reachable state with every value of `sw[2:0]` and `btnC`: 36 of 36.
  It also catches one flip that does not change the board, only keeps the simulation's `x` start state
  from clearing.
- **The Vivado column, read again.** `42` is not supported: `{<<{...}}` is "Re-ordering of the generic
  stream: Not Supported" (p.287); the "Concatenation of stream_expressions: Supported" row above it is
  the stream without re-ordering. `46` `continue` is unverified: "Jump statements: Not Recommended" is all
  the guide says. `48` `iff` is unverified: the same page lists "Iff event qualifier: Supported" and
  "Conditional event controls: Not Supported", and Conditional event controls (IEEE 1800-2017 9.4.2.3) is
  where the standard defines `iff`: slang's table of LRM clauses names 9.4.2.3 so, and its test for it is
  the standard's `always @(a iff enable == 1)`. `45` stays supported and now cites p.280 ("use it with the
  break statement"). The column check now lets a source that shows the guide contradicting itself be
  unverified even when it quotes a Not Supported row (`48`, `66`); 9 column edits of the changed and new
  rows were tried, all 9 refused.
- **`57`'s log quote came from the wrong run.** Its synthesis log holds two runs, and the quote was from
  the first, where the keypad module was still RTL. It now quotes the second (the LUT primitives pulled in
  from `unisim_comp.v`, `(11#1)`, 0 warnings). Which run the implementation used, the logs do not say.
- **`CLAUDE.md`'s corpus line added up to 78 of 73.** It now gives the measurement saved on 24 September
  (`corpus_results.json`, 89 folders): 8 build, 40 are testbench-only, 23 need their own pin file, 7
  hold netlist files, 10 hold code Vivado accepts or that is unverified, 1 is invalid code. (Round 7: of
  the 8, `dewfpga bit` alone built 2; 6 built only with a top the corpus harness named after the CLI
  refused to pick one, and 2 of the 8 are not the module the student's Vivado project built.) (Round 3
  wrote 24 and 9, and called one folder "two clock edges"; round 4 counted again, below.)

Tried, and dropped:
- Counting an `x` in the netlist as a mismatch, with only the board's start values: `32` failed on the
  RTL's `case` over an unset register. Hence the third copy.
- In `eqv_check.sh`, reading `cells_sim.v` with `read_verilog -lib`: yosys keeps its flip-flops as
  whiteboxes, which JSON cannot hold (`-nowb` drops them). Then a register's start value was lost in
  `write_verilog` (it stays an attribute of a merged wire) until `opt_clean -purge`.
- A probe for a concurrent assertion in the testbench (`assert property`): iverilog 13 refuses it, and the
  runner runs the same testbench on the netlist, so the probe would read as a silent wrong.
- A probe for a testbench without `$finish`: the runner needs it to end.

Found and left to later updates (reproduced, not fixed here):
- #3: the silent wrongs `58` and `59`; `-noautowire` has to keep `76` building.
- #4: `60` to `65`, `67` to `69`, and `71` to `73` in sim; `74`, reading `.v` files as Verilog 2005 (the
  CLI check ".v file with SystemVerilog inside builds" says the opposite of Vivado's default); `78`, with
  `57`'s netlist detector; `70`'s cells; `75`, where Vivado writes the bitstream and the recorded decision
  says timing FAIL is an error (the owner decides); a concurrent assertion in a testbench (`dewfpga sim`
  stops with "Try -gno-assertions or -gsupported-assertions", flags the CLI cannot pass).
- #5: `70`'s "does not fit" for two gates; `77`'s "Failed to get a constant init value for \num: \sw" with
  no file:line and no fix; a module whose file is missing from the folder ("Module `\adder4' referenced
  in module `\top' ... is not part of the design", no file:line; `dewfpga sim` does print `top.sv:2`);
  the async-reset rule's advice for `80`; the plan's "dead rule" line.
- #6: a Vivado-style testbench (a free-running clock, no `$finish`) waits 120 s and fails, and its advice,
  "SIM_TIMEOUT=600 dewfpga sim waits longer", cannot help it (measured: 120.48 s, exit 2). Vivado's
  simulator stops at its run time: the run scripts Vivado writes for each simulation (`.tcl`) in the
  corpus say `run 1000ns` 31 times and `run 20000ns` once; the `.log` files hold `run 1000ns` 17 times in
  10 files and `run 20000ns` 4 times in one (round 5: this said "the simulation logs" for the script
  counts). 10 portless module definitions in the corpus have a free-running clock and no `$finish` or
  `$stop` (round 5: this said 9; counted as a module with no ports or an empty port list, `always #` or
  `forever` in it, and no `$finish` or `$stop`; how the 9 was counted is not recorded).

**Break round 4.** The same three kinds of breaker ran against the tree after round 3 and sent 23
reports; two of them are the same break (a netlist that lost its reset), so 22 breaks. Each was run in a
scratch folder: all 22 reproduced. (This said "sent 22 reports" until the final count.) A first attempt
at this round stopped halfway (a network outage); its `eqv.py` rewrite and eight probe drafts were checked
here, one draft was rewritten (`81`) and the rest were finished. Fixed here:
- **Vivado supports 8 more things that no probe had.** Each is a probe now, with its UG901 row. Every
  new testbench passes on a correct design (iverilog on the RTL; for `13c`, `18c`, `21b`, `22e` and `64b`,
  which iverilog refuses, a yosys-slang netlist) and fails on the design with its construct broken (9
  edits, 9 caught).
  - Three new silent wrongs. `22c` an interface with ports (Table 27 p.288, 'Ports in interfaces:
    Supported'): yosys makes `c.q` an implicit wire, and the bitstream builds with 0 LUT and 0 FF, exit
    0, while `dewfpga sim` shows the counter. `22d` an array of interfaces ('Array of interface:
    Supported'): `p[0].d` and `p[1].d` become 1-bit implicit wires, so `led[1]` shows `sw[0]` and `led[0]`
    `sw[4]`. `81` a design module that calls `$finish` in a simulation check (Table 21 p.239, '$finish:
    Ignored'): the CLI's scanner takes a module that calls `$finish` for a testbench, so `dewfpga bit`
    builds its submodule `counter` as the whole design (`counter.bit`, exit 0, no warning) and `dewfpga
    sim` exits 0 printing nothing. The breakers' third form, a modport-typed port on an interface with a
    `clk` port, is the same class as `22c` (0 LUT, 0 FF, exit 0; `sim` stops at the port) and is not a
    probe of its own.
  - Refused: `13c` an unpacked array concatenation, `22e` a modport expression, `64b` an unpacked union
    (sim and bit); `18c` `unique0 if` and `21b` an assignment inside an expression (sim only: yosys
    builds them right).
  - `81` needed a runner change. The runner read only `top.json` and `top.bit`, so `81` read as "synth
    fail, bit fail", a refusal, while the student gets exit 0 and `counter.bit`. The runner now checks
    whatever netlist the CLI wrote and the row's note names the module; a runner that reads only
    `top.json` turns `81` BAD.
  - `81`'s first draft held both modules in `design.sv`. The CLI then hands yosys that file, `$finish`
    included, and yosys stops ("System task `$finish' outside initial block is unsupported."), an error
    rather than the silent wrong the breaker found. The submodule is in its own file now, as in the
    breaker's repro.
- **The equivalence bench passed a netlist that lost its reset.** Round 3 excused a difference while the
  netlist's copy with INITs left x was x; a netlist that never resets keeps that copy x forever. On the
  product's own netlists with every flip-flop reset or set pin that is not a constant tied to 0, round
  3's `eqv.py` printed EQV PASS for all six probes that have such pins (`09`, `10`, `21`, `31`, `32`,
  `34`; 31956, 20140, 96886, 96814, 46705 and 24440 bits excused). The excuse is gone. The RTL's
  registers that are x get the board's start value (from the RTL read by yosys up to `proc`: 1 where a
  reset sets the bit to 1, which yosys maps to FDSE or FDPE, else 0), and with a clock and buttons the
  bench holds every button for one clock edge before the first compare, so a state machine yosys
  re-encoded one-hot, which starts in no state on the board, is compared after its reset. All six: EQV
  MISMATCH now. The same change catches a start value the netlist lost (`lostinit`).
  - Setting a start value bit by bit broke `07`: `statetype [1:0] state` is a packed array of enums, and
    iverilog reads `state[2]` as an enum, not a bit ("Index state[2] is out of range", so EQV FAIL). A
    register is now read whole, its x bits set and written back through a concatenation; a variable of
    one enum type keeps bit selects (it takes no vector without a cast), and a 1-bit enum gets its item
    by name.
- **`eqv.py` started an LDPE at 1, and the notes said nextpnr does.** nextpnr-xilinx's `fasm.cc` (commit
  3fd7878): `int def_init = (type == "FDSE" || type == "FDSE_1" || type == "FDPE" || type == "FDPE_1") ?
  1 : 0;`. The product's FASM for a latch with a preset holds `AFF.ZINI`: it starts at 0. `eqv.py` gives an
  LDPE 0 now; round 3's gave 1. No probe has an LDPE, so no verdict changed.
- **Ports named `x` or `mode` broke the bench** (`'x' has already been declared in this scope`): the
  bench declared a reg per input under the port's own name next to its own `x`, `mode`, `seed`. Every
  name it declares has a prefix now.
- **Parts of `eqv.py` no test pinned**, each pinned now by an `eqv_check.sh` case: the buttons in the
  exhaustive walk (`cbutton`), the `inout` pins driven from outside and compared (`ioequal`, `ioread`,
  `iofloat`), all 4096 random cycles (`deep` now needs 4000; 512 and 3999 turn it red), the reset press
  before the first compare (`recode` shows its IDLE state, so a netlist in no state differs at once), the
  start values (`fdse`, `ldpe`, `ldfill`, `fillset`, `fillaset`, `pkenum`, `enum1`), and the lost reset
  and start value (`lostreset`, `lostinit`). `eqv_check.sh` has 30 cases; `test/run.sh` runs all 30.
  (Round 5: those cases pin the RTL start values of flip-flops with a synchronous reset only. Not
  starting async-reset flip-flops or latches, or reading a reset value's bits in the other order, left
  all 30 green; round 5 added the cases.)
- **The score line was unchecked.** `test/run.sh` compared only the runner's known-gap count. It now
  counts the whole line again from the rows and `expect.tsv` (synthesis, all four stages, supported and
  all four, known gaps). A runner that counts every supported probe as passing (the breaker's 77/77) or
  counts synthesis from the bit stage: green on round 3's tree, FAIL now.
- **The today column's quotes were unchecked.** Only its `file:line` was. The runner now also looks for
  every message the column quotes, word for word (a quote may leave text out with `...`). `01` quotes
  the latch error and its advice, `02` the fix. The breaker's mutation, the latch advice replaced with
  "something went wrong.", was a gap on round 3's runner and is BAD now. Rows that quoted what no stage
  prints were reworded: `08b` and `47` (code, not messages), `75` (the recorded decision, not a log),
  `81`; `22e`, `38` and `71` quote messages that hold apostrophes in double quotes. The check fails with
  any yosys, as the `file:line` check does. Under CI's yosys 0.68 (the YoWASP shim of round 3, brew
  untouched) all 100 probes matched except `75`, whose quote held the frequency nextpnr reached (33.61
  MHz from 0.69+post's netlist, 33.91 MHz from 0.68's); the number is outside the quote now.
- **Checks no test pinned**: the `.v` in the runner's `file:line` pattern (a new check makes the CLI skip
  `.v` files, and `74` has to say `expect.tsv says design.v:3, no stage printed it`), and the
  student-name check's `` `\name' `` form (its self-test now plants that form too).
- **Rows.** `22`'s source cited 'Modport expressions', the `.name(expression)` form that is `22e` now;
  `22` uses plain modports, which UG901 shows in its 'Modports' section (p.283-284). `58` said
  `led[1:0]` undriven: `led[1]` is a constant 0, `led[0]` has no driver, and what the LED shows was not
  measured. `63` was supported with "the probe applies no operator to a real", but UG901 names the cast
  'Cast operator' and lists 'Operators with real operands: Not Supported' next to 'Real ... data types:
  Supported' and "They can only be used as parameter values": the guide contradicts itself, so `63` is
  unverified. The column check did not see `63`'s paraphrase; it guards the two directions that hide a
  gap, and a supported row that names a Not Supported row errs toward counting one (`16b` and `18` name
  one to say why they are supported).
- **Sentences on the site and in the guide that #2 shows false.** Guide section 7 said one course file
  breaks and it is fixed for you: `57` (the course's netlist-form ready modules) is refused and `08b` (the
  port line with a comment in it) is not fixed. It also said the async-load reset and the dual-edge case
  both stop "with the line and the fix" (`03` builds with warnings, `04` has no line), quoted "take the
  original .sv" (the CLI says to delete the file), listed `interface` with `modport` as something Icarus
  accepts (only while no module port is typed with it: `22`, measured), and said a BOM went through (the
  CLI refuses it, with the command that removes it). Section 8 opened with "This covers the part of
  Vivado that CS223 uses, and no more" and named only the IP Catalog; it now names the language, with the
  25 September numbers and a link to `expect.tsv`. The error page `port-neither-input-nor-output` called
  the seven-segment module "the one course file that breaks" and said the language does not read `dp` as
  an output (the guide and `08`'s source say it does). The why page called the IP Catalog "the real
  limit"; it and the home page (English and Turkish) now name the language gap too. The README, its
  Turkish copy and the cli page said every `.sv`/`.v` is synthesized and a module with `$finish` is the
  testbench, "as in Vivado": they now say that a package or an interface alone in its file is left out,
  and that a design module calling `$finish` is taken for a testbench for now (`22b`, `23c`, `81`). The
  guide's HTML and PDF were rebuilt (13 pages; `CLAUDE.md` said 12). The desktop design is untouched:
  text only.
- **The notes and `CLAUDE.md` were wrong**, corrected above: nextpnr starts an LDPE at 0; 25 of the 37
  netlist-passing probes have LUTs, not 22; `58` is missing from the `-noautowire` list and its LEDs were
  never measured "dark"; round 2's "the only probe whose synthesis passes and bitstream fails" and "18
  more things we fail" were overturned in round 3; the corpus has 23 pin-file folders and 5
  unnamed-instance folders (10 in that group), and its "two clock edges" folder fails on `if(reset ||
  clear)` in an `always_ff @(posedge clk, posedge reset)`, probe `53`'s pattern.

Tried, and dropped:
- Setting a register's start value with `force` and `release`: iverilog wants the same cast there ("This
  assignment requires an explicit cast.") for an enum. Walking a 1-bit enum to its item with `.first()`
  and `.next()` through a hierarchical name: vvp stops at an assertion in `v2009_enum.c`.
- Refusing any "not supported" in a supported row's source: `16b` and `18` say it to explain their
  column.

Found and left to later updates (reproduced, not fixed here):
- #3: the silent wrongs `22c`, `22d` and `81` become errors (`81`: a design module is taken for a
  testbench because it calls `$finish`).
- #4: `22c` and `22d` compile (interface ports, interface arrays), `22e`, `13c`, `64b`, and in sim `18c`
  and `21b`; `81` builds as Vivado builds it, which needs the scanner and yosys (it stops at `$finish` in
  an always block) to ignore `$finish`; the course's netlist-form modules (`57`) and the port-line fix
  with comments (`08b`), both now in the guide as open.

**Break round 5.** The same three kinds of breaker ran against the tree after round 4 and sent 22
reports. Each was run in a scratch folder: all 22 reproduced. Two side claims inside them did not: that a
course project hits the same `eqv.py` bug through a wire named `message` (`grep -rlE 'message'` over the
corpus `.sv` and `.v` files, also without case: 0 files; the Lab 4 shape the fix covers was found in one
repo's logs and is the case `regport`), and that the Vivado 2021.2 lab writes its range-only port in an
`always_ff` (it is an `always_comb`, as `08c`'s source says). A first attempt at this round stopped
before it changed anything (a network outage). The eight probe folders a round-4 attempt had left
without rows (`13c`, `18c`, `21b`, `22c`, `22d`, `22e`, `64b`, `81`) already had their rows when this
round started: 100 folders, 100 rows, and the runner's folder check agreed. Fixed here:
- **The netlist stage's RTL side had a copy that no test ran.** `eqv_check.sh` listed the RTL's
  registers with its own copy of the runner's yosys command, so deleting `flatten` from the runner left
  every test green while its comparison passed a netlist whose clock divider, in a submodule, counts
  the wrong way (`EQV PASS: 147456 output bits compared, all equal`: the submodule's register was never
  started, so its LEDs stayed `x` in the RTL and were never compared). The comparison is one script now,
  `test/sv/eqv.sh`: the runner calls it on the product's netlist, and `eqv_check.sh` calls the same
  script on its netlists, which now arrive as the product's do (JSON, the cell library as blackboxes).
  New cases `subreg` and `subfault`: a counter with no reset and no start value in its own module; the
  netlist counts down in `subfault`, which has to fail. Deleting `flatten` from `eqv.sh` turns `subfault`
  red, and deleting `proc` turns 25 cases red. `eqv.sh` also prints `EQV FAIL` when the bench does not
  compile or compares nothing, so a FAIL case now needs the bench's own count of differing bits; neither
  of those passes one.
- **`eqv.py` started a submodule's input port instead of the register behind it.** A register `n` of
  `top` that feeds a submodule's port `D`, next to a register of `top` also named `D` (the shape of a
  CS223 Lab 4 two-bit counter in the corpus): after `flatten` the bit is called `n` and `A1.D`,
  both names end in a name the always block writes, and `A1.D` sorted first. The bench then set a net
  and did not compile (`'eqv_rtl.A1.D' is not a valid l-value for a procedural assignment.`), so a
  correct netlist read as `netlist fail`. `rtl_starts` now looks first at the names declared in the
  module the always block is in (each instance's module lines come from yosys' `$scopeinfo` cells). The
  same fix covers a top wire named like the submodule's register it carries (`subreg`'s `q`). New case
  `regport`, the breaker's design: red before, `EQV PASS: 196608 output bits compared, all equal` after.
- **Parts of `eqv.py` no case pinned.** Each of these left all 30 cases green and now turns one red:
  the compare after the buttons change, before the clock edge (`mealyb`: `led[0] = q & btnC`, lost in
  the netlist; `EQV FAIL: 198 of 262144`); starting async-reset flip-flops (`xstarta`, an FDCE), latches
  (`xstartl`, an LDCE) and each bit of a reset value in its own order (`fillasym`, a reset to `4'b0011`:
  FDSE for bits 0 and 1, FDRE for 2 and 3). Round 4's notes said the start values were pinned; only a
  synchronous reset's were.
- **Runner guards no check pinned.** The check of `"..."` quotes in the today column (`02` quotes the
  unnamed-instance fix that way): deleting it left the suite green, and with the fix text gone from the
  CLI, `02` still matched. The value check of the vivado column: deleting it let a row written
  `Supported` through, and `01` stopped counting as a gap. Both are pinned now (`st_fixtext`,
  `st_vivvalue`), and the CLI check `unnamed instance -> line and fix` now looks for the fix too.
- **Vivado accepts 15 more things that no probe had.** The breakers found 14; `51c` turned up while one
  of their notes was measured. Each is a probe now, with its source: 13 fail a stage, `51c` is a new
  silent wrong among them, and `84` passes all four. Every new testbench passes on a correct design
  (iverilog on the RTL; where iverilog refuses it, a yosys-slang netlist, and for `08c` the line `bit`
  rewrites) and fails on the design with its construct broken (18 edits, 18 caught).
  - `08c` the course's port-line shape where a port has only a range (`output logic [6:0] seg, [3:0]
    an`), written in an `always` block. A Vivado 2021.2 lab in the corpus builds it (0 errors, bitstream
    written; its port list is `output logic [2:0] <one>, [2:0] <other>` and the second is written in an
    `always_comb`, not the `always_ff` the breaker named). `dewfpga sim` stops (`'an' is not a valid
    l-value`), `dewfpga bit` writes the direction in and builds, and after that `sim` passes: the same
    folder passes or fails `sim` by which command ran first. A strict reader calls that port a net (IEEE
    1800-2017 23.2.2.3, slang: "cannot assign to a net within a procedural context"); Vivado and the
    product's port-line fix are the lenient ones.
  - `13d` a packed 2-D array indexed by a variable, then a bit or part select (`grid[i][j] <=` in a loop,
    `grid[sw[13:12]][3:1]`): iverilog refuses both, yosys builds it right. A Vivado 2019.1 course project
    in the corpus reads and writes a `logic [7:0][7:0]` array with two loop indices, `[i][j]`, and builds.
  - `12c` a packed array of structs indexed by a signal, then a member select (`cars[sw[15]].x`): yosys
    stops with "Index in generate block prefix syntax is not constant!", about a generate block the code
    does not have.
  - `33c` the textbook's tristate buffer module (`assign y = en ? a : 4'bz`) in a submodule, four
    instances each driving a nibble of an output port: nextpnr has no place for yosys' `$_TBUF_` cells
    and the CLI says the design does not fit. One instance driving the whole port, or the same buffers in
    `top`, builds (measured). The testbench wants `z` on a disabled nibble, so a fix that turns these
    buffers into logic (as `52`'s internal bus should be) would fail it.
  - `51b` a packed 2-D `localparam` as a seven-segment table: both tools refuse it.
  - `51c` the same table with its type named first, `typedef logic [3:0][6:0] tab_t; localparam tab_t SEG
    = ...`. The breakers reported that this form builds; it does, as zeros: `pnr ok: 0 LUT, 0 FF`, `seg` is
    0 for every input in the netlist (every segment on), exit 0 and no warning. yosys-slang's netlist of
    the same file gives the right table. iverilog 13 stops at an assertion. A new silent wrong.
  - `40b` a module name and `(` inside a `$display` string in a design module (`"counter (u_cnt)
    wrapped"`): the scanner reads comments out but not strings, so it reports an unnamed instance on the
    `$display` line and suggests an edit inside the string. `40` covered only `$display(` itself.
  - `82` `$fopen`, `$fdisplay` and `$fwrite` left in a design (UG901 Table 21: Ignored) and `83`
    `$realtobits` and `$bitstoreal` (Supported): yosys cannot resolve them. iverilog refuses `83` too
    (it cannot evaluate `$realtobits` in a parameter).
  - From UG901 Table 27, rows the breakers checked by hand: `85` a bitstream cast to an unpacked array,
    `23e` a package that exports a name it imported, `86` `extern module`, `87` a `config` (Table 20
    too), `88` a class's static function. All five stop at synthesis; iverilog simulates `23e` and `87`
    (it skips the `config` with a "sorry").
  - `84` a `repeat` with a constant count in `always_comb` (UG901 Table 20: Supported): it passes all four
    stages. It is a probe for iverilog's warning, which `dewfpga sim` prints: "A repeat statement cannot
    be synthesized in an always_comb process." The row quotes it, so when #5 filters the warning the row
    has to change.
- **Sentences #2 wrote or left false.**
  - The home, why and Turkish pages said each construct is measured, and the guide said `test/sv` holds
    one probe per construct a student may write. This round found 15 more; they now say "the constructs
    measured so far", and section 8 says the list is not every construct. Its numbers are the 26
    September ones: 73 of the 99 Vivado-supported constructs fail a stage (52 stop before a bitstream,
    12 fail only in `sim`, 1 has no model, 8 build a wrong bitstream).
  - Guide section 2 said every other Vivado-accepted case "stops with the line and the fix. Section 7
    lists them." `04`, `53`, `77` and `85` stop with no `file:line`, `56` with a line in yosys' own
    `cells_sim.v`, `16c` with no fix, `52`, `70` and `33c` with "does not fit", `12c` with a message about
    a generate block, and the silent wrongs build. It now says so. Section 7
    now lists the two corpus patterns it left out (`53`'s async reset ORed with a clear, one folder, and
    `80`'s statement after the reset's `if`/`else`, one folder), and says that only `bit` writes a
    port's direction in (`08c`). Its "5 of 89 lab folders from old student repos" now says that 4 of the
    5 are one repo's copy of the course's handout folder. Section 2 also said every `.sv` is synthesized
    and named only `$finish`: it now says what the README says.
  - The README, its Turkish copy and the cli page told the student to keep `$finish` in the testbench;
    a design module that calls `$stop` is taken for a testbench the same way (the scanner matches
    `$finish|$stop`, measured with `81`'s files). They now name both.
  - These notes: a failing unverified probe was called a `PASS`, but `03`, `03b`, `05` and `39` build a
    bitstream from a failing netlist and are gaps (the notes and `test/run.sh`'s header, both fixed);
    round 3's `run 1000ns` counts were from Vivado's `.tcl` run scripts, not its logs; the portless
    free-running modules are 10, not 9; round 4's start values were pinned for synchronous resets only;
    round 2's five netlist-form folders are four copies of one handout folder and one student project.
    `CLAUDE.md`'s corpus line says the same now.
  - The guide's HTML and PDF were rebuilt (13 pages). The desktop design is untouched: text only.

Tried, and dropped:
- `23e` as `import p1::*; export p1::*;`: yosys-slang says `K` is undeclared, and it is right. IEEE
  1800-2017 26.6 exports only names actually imported, and a wildcard import makes `K` a candidate until
  the exporting package uses it. The probe imports and exports `p1::K` by name; iverilog then simulates it
  (with the wildcard it could not bind `K` either).
- `regport`'s first netlist was written as RTL (`always_ff`): its flip-flops then start `x` in the
  netlist, and the bench, rightly, called that a difference. The case builds its netlist from FDRE
  primitives, as the product's is.
- A first sweep of the `eqv.py` mutations printed "red: none" for every one: zsh does not split an
  unquoted list, so each run checked only the `equal` case. The sweep now splits the list in bash; the
  results below are from that run.
- A probe for the XDC forms `[get_ports {sw[*]}]` and `[get_ports {sw[0] sw[1]}]` (break 9): every probe
  uses the course's master XDC, so the form cannot be a probe without a second runner path. It is left
  with its fix (below). A `$stop` twin of `81`: the scanner matches both with one pattern, so the text
  fix above is what was false; no probe.

Found and left to later updates (reproduced, not fixed here):
- #3: the silent wrong `51c`.
- #4: `08c` and `13d` in sim; `12c`, `23e`, `33c`, `40b` (the scanner has to skip strings, not only
  `$display(`), `51b`, `82`, `83`, `85`, `86`, `87`, `88`; the XDC forms Vivado accepts in `get_ports`, a
  wildcard (`sw[*]`) and a list (`{sw[0] sw[1]}`): the check reads only the first name and stops with
  "PACKAGE_PIN but no IOSTANDARD" for every port, and nextpnr-xilinx refuses both forms too (#6 owns the
  IOSTANDARD test path).
- #5: `12c`'s message about a generate block, `33c`'s "does not fit", `85`'s message with no
  `file:line`, `40b`'s fix that edits a string, and iverilog's `repeat` warning that `84` quotes.

**Break round 6.** The same three kinds of breaker ran against the tree after round 5 and sent 36
reports. Each was run in a scratch folder: all 36 reproduced (a mutation report by its mutation and the
checks that could catch it, not by a full suite run each; one had a moved line: the lenient-verdict
mutation is on `test/run.sh` line 130, not 126). A first attempt at this round stopped before it changed
anything (a network outage). The eight probe folders the task named as lacking rows (`13c`, `18c`,
`21b`, `22c`, `22d`, `22e`, `64b`, `81`) have had their rows since round 4: 115 folders, 115 rows. Fixed
here:
- **The netlist stage failed correct netlists of three shapes.**
  - A wire that names a slice of an output register (`wire [3:0] low; assign low = led[3:0];`; a corpus
    dot-matrix project has the same shape): `rtl_starts` preferred a name that is not a port, picked
    `low`, and the bench did not compile (`'eqv_rtl.low' is not a valid l-value`). It now looks for the
    name the always block writes whenever more than one name is left. That lookup read whole source
    lines, so an `assign` on the always block's line counted as written too; it now cuts the text at the
    columns of yosys' `src` attribute.
  - A 1-bit enum declared in a submodule or at file scope: the bench named the item in top's scope
    ("Unable to bind wire/reg/memory" for `eqv_rtl.OFF`). It now reaches the item through the variable,
    `s.first()` or `s.last()` (a 1-bit enum has at most two items), whichever has the board's value, so
    where the enum is declared does not matter. (Round 4 found that walking to an item with `.next()`
    through a hierarchical name stops vvp; `.first()` and `.last()` alone run.)
  - A register yosys moves into a ROM. The corpus Lab 4 Gray counter (a full `case`, a `clear` and a
    `preset` not named `btn*`) becomes 6 FDREs whose power-up state holds the first state one clock
    longer; the RTL, started at the board's 0, is one step ahead, and the bench counted 9 differing bits
    (`EQV MISMATCH at 9000 (posedg): q[0] rtl 1, netlist 0`). A register without a start value promises
    no start. The bench now runs a second copy of the RTL, started as `dewfpga sim` starts it (`x`, until
    the `case` default), and a compare where the netlist differs from the first copy passes when every
    bit the first copy knows equals the second: the board then shows what the student's own simulation
    shows. The excuse is per compare, never per bit, and an `x` in the second copy excuses nothing. The
    corpus shape now: `EQV PASS: 36864 output bits compared, all equal (at 9 compares to the RTL as
    dewfpga sim starts it, without start values, not as the board does)`.

  New cases `regslice`, `alias`, `enum1sub` and `romstart`: red on round 5's `eqv.py` and `eqv.sh`,
  `EQV PASS` now.
- **Parts of the netlist stage no case pinned.** Each of these left all 37 cases green on round 5's tree
  and now turns at least one red: the start of a multi-bit enum (`enumstart`: a netlist that powers up
  in state `11`, which the RTL never has), of a memory (`memstart`: a LUT RAM that powers up all ones),
  the compare after the switches change and before the clock edge (`datasw`, the switch counterpart of
  round 5's `mealyb`), `eqv.sh`'s fail-closed guard (`nobench`: a bench that does not compile while the
  RTL does is `EQV FAIL`, exit 1, never a skip), the packages-first order (`pkgfile`: a package in a
  file that sorts after the design), the "nothing compared" fail (`nothing`), and the fallback to the
  name the always block writes (`alias`, `regslice`). The new excuse is pinned both ways: without it
  `romstart` is red, per bit instead of per compare `mixstart` is red (a netlist that takes one bit
  from each start), and with an `x` that excuses `subfault`, `enumstart` and `memstart` are red.
  `eqv_check.sh` has 48 cases; `test/run.sh` runs all 48.
- **Runner and suite guards no check pinned**, each pinned now by a check that breaks it on a copy:
  a row's second quote (`st_quote2`: `04`'s dual-edge advice changed in the product) and its second
  `file:line` (`st_line2`: `76`'s second line made wrong in the table; the breakers counted 24 and 17
  rows with more than one on round 5's table); an `eqv.sh` failure other than exit 2 (`st_eqvexit`:
  `07`'s bench made not to compile has to be a netlist fail; the runner's `-eq 2` could become `-ne 0`
  with every test green); the re-derived verdict's exact mode (`st_exact`, with the measured yosys and
  iverilog: a row that says `ok` where `expect.tsv` records a netlist fail; `sv_rows` takes the table as
  an optional argument for it); every word of the student-name check (`st_names` plants a quoted name
  after each of its 10 words; it planted 3 forms).
- **Probes that pinned nothing the CLI could lose.** No probe's design had two files that reach `sim` and
  `bit`, so a Makefile that compiles only the first design file left every test green: `91` is a
  submodule in its own file, the usual lab layout. No probe's `$display` reached synthesis (`40` and `40b`
  stop at the scanner, `81`'s module is taken for a testbench), so dropping `delete t:$print` left every
  test green: `92` is a debug print in a clocked design. `44`'s do-while could not tell do-while from
  while (its condition is true on entry): it now has a second loop whose condition is false on entry,
  and a reader that tests the condition first fails its testbench.
- **Vivado supports four more things we fail, and no probe had them.** Each is a probe now, with its
  source. Every new testbench of this round passes on a correct design (iverilog on the RTL) and fails
  with its construct broken (10 edits, 10 caught; list in the evidence).
  - `89` logic on a divided clock. The course's master XDC arrives with `create_clock` commented out,
    and the CLI then checks every clock at 100 MHz: four decimal digits of a 14-bit value on the slow
    clock reach about 35 MHz, and `bit` stops with "timing not met". 11 routed Vivado timing reports in
    the corpus (2015.2 to 2021.2), each next to the `.bit` its run wrote, list a register clocked from a
    register under "no clock driven by root clock pin" and do not time it; with no `create_clock`, the
    board clock is listed there too. With `create_clock` uncommented, nextpnr checks the divided clock at
    its default 12 MHz and builds the breaker's version. The same rule stops a button used as a clock
    (`posedge btnC`, no `clk` at all; measured, not a probe of its own).
  - `90` `initial if (N < 8) $warning(...)`, UG901's own form of a parameter check (Table 27 p.286; the
    report said p.285): yosys "Can't resolve task name" for `$warning`, and for `$info` the same. The
    form without `initial`, and the `initial` form while its condition is false, build.
  - `22f` an interface without ports whose members top drives and reads (`bus.a`): 0 LUT, exit 0, while
    `dewfpga sim` is right. It shows that `22c` and `22d` fail for the same reason, a member of an
    interface instance used in the module that instantiates it, not for their ports or their array.
    `22c`'s row says so now, so a #3 fix aimed at "ports in interfaces" would not pass it.
  - `56b` a file that holds only file-scope typedefs (UG901 'Compilation Units', p.270): the CLI hands
    the tools only files with a module, and both stop at the first use in `design.sv`, naming neither
    the missing file nor the fix. In which order Vivado compiles such a file is not in the guide. The
    README, its Turkish copy, the cli page and the guide said only a package or an interface alone in
    its file is left out; they now say a file that holds no module.
  - Two whose Vivado status no source settles, recorded as unverified. `63b` a real literal in a
    localparam used in an expression (`localparam MAX = 1e1; ... count == MAX - 1`; a lab writes `50e6`):
    yosys 0.69+post segfaults, and bash prints the crash and the Makefile's whole awk program (1.4 kB)
    with no `file:line`; `parameter real` times a signal, and `int'` of a `localparam real`, crash the
    same way. `37b` `logic [3:0] sum = sw[3:0] + sw[7:4];`: `dewfpga sim` follows IEEE 1800-2017 6.8
    (an initializer, set once, so `x`), `dewfpga bit` builds an adder, and neither says a word. Its
    testbench checks the standard's reading, so it is a silent wrong whatever Vivado does.
- **Rows and sentences #2 shows false.**
  - `33` said "the inout read-back is lost". Reading back a bidirectional pin works (`33`'s `JA[0]`,
    and `33b`); what is lost is a pin the design sets to a constant `z` (`assign JA[7:1] = 7'bz`) and
    then reads. The row, these notes and guide section 8 say so now.
  - `82`: with `$fopen` gone, `$fdisplay` stops yosys next, not `$fwrite`. `59` builds with nextpnr's
    generic "No clocks found in design" warning, not with no warning. `08c`'s comment said `an` takes
    `output logic` from `seg`; its own source says a strict reader makes it a net.
  - The cli page and guide section 5 said the course's seven-segment file "builds as it is". The course
    also hands `SevSeg_4digit.sv` out in netlist form (row `57`; the corpus holds 3 netlist-form copies),
    which the CLI refuses; both now say so, and section 7 names it among the netlist-form modules. The
    error page `port-neither-input-nor-output` said the fix is skipped when "a comment sits inside the
    port list"; the course file has three comments there and builds. It now names the two cases that
    miss (a comment between `seg,` and `logic dp`, a `;` inside a comment), as section 7 does.
  - The why page said each construct sits "next to what Vivado's documentation says"; 10 rows cite only a
    Vivado log or IEEE 1800. It now says "what Vivado does and the source for it". It also called clock
    dividers "the part this chain handles"; it now names `89`'s difference. Guide section 2 said section
    7 lists "what old student repos hit" and section 8 said "what the course's own files hit"; both say
    the course's files and old student repos now.
  - The README, its Turkish copy and guide section 2 said `bit` refuses to write a bitstream when timing
    is not met, and nothing about what is timed. They now say that without `create_clock` every clock
    is checked at 100 MHz, a divided one too (`89`), and that a multiplier in a DSP48E1 with a register
    inside is not timed at all (below).
  - Guide section 8's numbers are this round's: 77 of the 105 Vivado-supported constructs fail a stage
    (55 stop before a bitstream, 12 fail only in `sim`, 1 has no model, 9 build a wrong bitstream). The
    guide's HTML and PDF were rebuilt (13 pages); the desktop design is untouched, text only.
  - These notes: the `-noautowire` list named 6 of the 9 probes it changes (above), and did not say that
    `22`, legal code, stops building with it.

Tried, and dropped:
- Leaving the RTL's registers `x` instead of starting them (round 3's first reading): `32`'s `case` on an
  unset register takes its default branch in the RTL and not on the board. Hence two copies of the RTL.
- Excusing a difference bit by bit, each bit equal to either copy: `mixstart`, a netlist that takes bit 0
  from one start and bits 2:1 from the other, passed. The excuse is per compare.
- Quoting the crash in `63b`'s row: the YoWASP build of yosys 0.68, CI's version, does not
  segfault; it stops at an internal cell check, and the row failed there (`expect.tsv quotes
  'Segmentation fault: 11', no stage printed it`). The row names the crash without quoting it.
- A probe for the DSP timing (break 2): every stage passes, so the runner would count it `ok`, and no
  stage compares timing with a real delay. It is left with its fix.
- A probe for two `assign`s to one `wire` (break 8): its `vivado` column would need a source for what
  Vivado does (the breaker says it refuses a multi-driven net; no log here shows it), and the message is
  #5's.

Found and left to later updates (reproduced, not fixed here):
- #3: the silent wrongs `22f` and `37b`. Paths through a DSP48E1 with a register inside are not timed:
  three multiplies and an add in one clock print `PASS at 100.00 MHz` (282.97 MHz, `DSP48E1: 5/120`, no
  DSP cell in the critical path), while the same logic in LUTs reaches 34.04 MHz; nextpnr-xilinx 3fd7878's
  `getPortTimingClass` returns `TMG_IGNORE` for a registered DSP48E1.
- #4: `56b` and `90`; `89`'s timing rule, with `75`'s (Vivado writes the bitstream; the owner decides);
  `63b`, if Vivado builds it.
- #5: any yosys crash prints the Makefile's whole awk program and no `file:line` (`63b`); two `assign`s to
  one `wire` stop in nextpnr with "Net 'y' is multiply driven by cell ports ..." about internal cells,
  no `file:line` and no fix (for `wire y`, `dewfpga sim` shows `x` and passes; for `logic y`, iverilog
  names the line).
- #6: with two clocks the board clock is printed as `$abc$...$aiger$oN` on the pnr line and in the timing
  error (`32`: `$abc$2758$aiger$o7 399.20 MHz`), next to round 2's garbled name of `03`.
- #12: `dewfpga sim` with two design roots says `Name it:  dewfpga bit decoder` (`check_xdc.py` writes
  `bit` for sim too); `dewfpga sim decoder` works. The plan lists it with top selection in VS Code.

**Break round 7.** The same three kinds of breaker ran against the tree after round 6 and sent 21
reports. Each was run in a scratch folder: 20 reproduced as written and one in part (the port-line
comment, below); a mutation report by its mutation and the cases or checks that could catch it, not by a
full suite run each. Three side claims did not hold (below). A first attempt at this round stopped before
it changed anything (a network outage). The eight probe folders the task named as lacking rows (`13c`,
`18c`, `21b`, `22c`, `22d`, `22e`, `64b`, `81`) have had their rows since round 4, as round 6 found too:
123 folders and 123 rows before this round, 132 and 132 after. Fixed here:
- **The netlist stage passed wrong netlists through round 6's sim-start excuse.** A compare passed when
  every bit the RTL knows equalled a second copy of the RTL started as `dewfpga sim` starts it, decided
  compare by compare. A digit-select counter with no reset and no start value (a lab's display scan)
  showed the hole: `dewfpga sim` keeps `sel` at `x` forever, its `case` takes the default at every
  compare, and a product netlist with one LUT INIT bit flipped (digit 0 never lights) equalled the
  board's start at some compares and that copy at the others: `EQV PASS: 196608 output bits compared, all
  equal (at 3072 compares to the RTL as dewfpga sim starts it, ...)`. A netlist that lost the counter and
  shows 1111, what sim shows, passed the same way. The exception is now one decision for the whole run:
  the netlist has to follow the RTL as the board starts it at every compare, or follow the sim copy at
  every compare, equal to the board's start while a register bit of the sim copy is still `x` (its
  outputs then come from a branch no board takes) and equal to the sim copy, every bit known in it, once
  none is. Both netlists: `EQV FAIL: 3072 of 196608` and `EQV FAIL: 9216 of 196608`. New cases `simflip`
  and `simlost`: `EQV PASS` on round 6's bench, `EQV FAIL` now.
- **A reset on a switch was not pressed before the compares.** The bench held only `btn*` inputs for one
  clock edge first, so a state machine yosys re-encoded one-hot passed with its reset on `btnC` and failed
  with the same reset on `sw[15]` (`EQV FAIL: 10 of 196608`, all before the walk first raised `sw[15]`).
  The bench now also holds every input bit that resets a register of the RTL (the `SRST` and `ARST` of
  the flip-flops yosys makes of the RTL, when they are an input bit), at its active level. The corpus
  Gray counter round 6 made the excuse for (its `clear` and `preset` are switches) now passes without it.
  Five cases pinned a register's start through a switch reset (`xstart`, `fillset`, `fillaset`,
  `xstarta`, `fillasym`); pressed first, that start no longer shows (with the reset value ignored, all
  five stayed green), so their reset is now built from two switches, `sw[15] & sw[14]`, which the bench
  does not press, and the reset-value mutation turns `fillset`, `fillaset` and `fillasym` red again. New
  case `swreset`: `EQV FAIL` on round 6's bench, `EQV PASS` now.
- **The bench did not compile for an output that is part register, part `assign`** (`always_ff ...
  led[3:0] <= ...; assign led[15:4] = sw[15:4];`): the start wrote `led` whole, iverilog refused it
  (`Cannot perform procedural assignment to variable 'eqv_rtl.led' because it is also continuously
  assigned.`), and a correct netlist got `EQV FAIL`. `eqv.sh` now reads the names iverilog gives there,
  and `eqv.py --bits` writes the bench again with those registers started one bit select at a time (a
  bit select of a packed array of more than one dimension picks an element, so such a variable fails
  the bench by name instead). iverilog shows such a register bit as `z` before its first write, not `x`,
  so the start takes `z` for unset too. New case `partassign`: red on round 6's bench, `EQV PASS` now.
- **Parts of the netlist stage no case pinned**, each pinned now: "an `x` in the sim copy excuses
  nothing" (dropping it left all 48 cases green; `xhold`, a RAM never written read at a registered
  address, where the netlist reads `x` and so does the sim copy), and `STARTS_AT_1`'s `FDSE_1` and
  `FDPE_1` (`negset`, falling-edge registers with a synchronous set and an asynchronous preset). No probe
  had a falling-edge register either: `31b` has both, with resets built from two switches, so the start
  shows. `eqv_check.sh` has 54 cases; `test/run.sh` runs all 54.
- **`13d`'s testbench missed faults.** It is the only check of `13d`'s netlist (iverilog cannot compile
  the RTL), and it clocked the grid in and picked the row and column with the same switches, so 16 LUT
  INIT flips that change the netlist passed it. It now clocks the grid in from one value and picks the
  row and column with another (the 256 patterned values, then 19744 random pairs). Over all 432 LUT bits
  of the product's netlist: 414 caught (the breaker counted 308 with the old testbench). The 18 that pass all sit in the LUT that drives
  `led[12]`, and they are exactly the 18 input combinations of that LUT that never occur over every grid
  value and every row and column (1048576 cases), so none of them changes what the netlist does.
- **Runner and suite guards no check pinned**, each pinned now by a check that breaks it: the rtl
  stage's exit-code half (`st_rtlexit`: `07`'s testbench made to call `$error` and still print `PASS`;
  `st_tbfail` pinned only the `PASS` half); a missing score line (`sv_rows` compared the line only when
  there was one; `st_score` now also gives it a log with no score line and one that writes `Synthesis`,
  and each has to fail); the personal-path check, which skipped all of `test/run.sh`. It now scans every
  file: a home folder is `/Users/` and a name, `test/run.sh` writes its planted paths through `printf`'s
  `%s`, and a new check plants one in `test/run.sh` itself.
- **Constructs no probe had.** Each is a probe now, with its source; every new testbench passes on the
  RTL (iverilog) and fails with its construct broken (evidence below).
  - `93` two modules nothing instantiates, in one file named after one of them. When two roots qualify,
    the scanner takes one named like the `.xdc` or like its own file without saying so: `counter.sv`
    holding `counter` and the board version `top` builds `counter`, exit 0, `counter.bit`, and with one
    design file the CLI prints no `top module:` line. Saved as `lab4.sv`, the same file stops and names
    both. Two corpus Lab 4 projects have this shape (Vivado 2015.2; each `.xpr` and `runme.log` names the
    board version as the top): the CLI alone builds the plain counter of one (`061`, `pnr ok: 6 LUT, 6
    FF`), and refuses the other (`058`), where the corpus harness then named the plain one. Guide section
    2 said "names both and you choose"; it, the README, its Turkish copy and the cli page name the
    exception now.
  - `94` a variable raised to a constant power, `sw[7:0] ** 2` (UG901 p.278: "A**B is supported if A is
    a power of 2 or B is a constant."): yosys leaves a `$pow` cell, nextpnr has no place for it, and the
    CLI says the design does not fit. `16'd3 ** sw[2:0]`, which the note does not cover, stops the same
    way; `2 ** sw[3:0]` and `sw[7:0] * sw[7:0]` build.
  - `96` a one-bit vector port (`[N-1:0]`, `N = 1`) and `96b` a port numbered from 1 (`[4:1]`, with the
    lab's own XDC; the runner now takes a probe's own `Basys3_Master.xdc`): the CLI's XDC check names a
    one-bit vector port without its index and numbers every port's bits from 0, so it stops before place
    and route with "these ports have NO pin" and a fix that does not apply. nextpnr-xilinx places both
    right when run on the product's `top.json` (`led` and `sw` on `led[0]`'s and `sw[0]`'s sites; `sw[1]`
    to `sw[4]` on theirs).
  - `97` UG901's `(* ram_style = "block" *)`: yosys builds a RAMB18E1 despite `-nobram`, nextpnr does not
    time it (`pnr ok: 0 LUT, 0 FF, no clocked paths, timing not applicable`), and yosys' `cells_sim.v`
    has no model for it, so the netlist reads `z`. It counts with `35` as a bitstream the suite cannot
    check. `(* rom_style = "block" *)` on an initialized ROM gives a RAMB18E1 the same way (measured,
    no probe). README, its Turkish copy and guide section 8 said every memory becomes LUTs; they name the
    exception now.
  - Three whose Vivado status no source settles, recorded as unverified: `95` a submodule with ports and
    no body whose output top uses (yosys makes it a blackbox, and the CLI says the design does not fit);
    `98` a module named `INV` (`GND`, `VCC` and `MUXF7` too; `BUF` builds): yosys stops in its own
    `cells_sim.v`, with no line of the student's file; `99` `parameter string INIT_FILE = ...`: a yosys
    syntax error with no fix, while the untyped form builds and matches the RTL.
- **Rows and sentences #2 shows false.**
  - "14 silent wrongs" (these notes, the plan): `expect.tsv` has 15 rows where the bitstream builds and
    the netlist fails, and the runner counts all 15 alike. The 15th, `35_mmcm`, fails for lack of a
    model, not because it is wrong. The notes now name it; with `93` and `97` there are 17 such rows: 15
    silent wrongs and 2 bitstreams no model can check.
  - "8 build" (`corpus_results.json`, in round 3's `CLAUDE.md` item and round 1's list below):
    `dewfpga bit` alone built 2 of the 89 folders (`004`, `061`); the other 6 built only after the corpus
    harness named a top the CLI had refused to pick, and 2 of the 8 (`058`, `061`) are not the module the
    student's Vivado project built. `CLAUDE.md` and both places here say so now.
  - `22f`'s source said UG901's p.282 example uses an interface's members in the module that instantiates
    it; the example uses them only inside the submodules, through their interface port. The row says so,
    and rests top's own use on Table 27's "Hierarchical names: Supported" (p.288).
  - The why page gave each construct's source as "its user guide, a Vivado log, or the language
    standard"; `04` and `05` cite forum posts, marked weak. It names them now.
  - Guide section 7 said the port-line fix misses "a comment inside the port list (after `seg,` ...)". It
    misses a comment between `seg,` and `logic dp` (at the end of the `seg,` line, on a line of its own,
    or a `/* */` between the two) and a comment anywhere in the port list that holds a `;`; a comment
    after `logic dp,` or before the comma is fine. The same sentence quoted the yosys error in backquotes
    that broke the guide's HTML (the rest of the paragraph rendered as code, up to `bit`). Both are fixed,
    and the guide's HTML and PDF rebuilt. The error page's sentence ("unless a comment sits between
    `seg,` and `logic dp`") holds.
  - Guide section 8's numbers are this round's: 82 of the 111 Vivado-supported constructs fail a stage
    (58 stop before a bitstream, 12 fail only in `sim`, 2 have no model, 10 build a wrong bitstream).

Side claims that did not hold:
- The port-line report's "a comment after `seg,` on the same line is fixed": only because the breaker's
  comment ended in a comma (`// a comment after seg,`), which the fix reads as the port separator; with
  `// the segments` there the line is not fixed (evidence below).
- "Vivado 2020.1 logs in the corpus warn on an undriven net ([Synth 8-3848])": the two corpus logs with it
  are Vivado 2015.2 and 2021.2.
- `94`'s report put UG901's "Power operator" on p.227-228 and read it as supported without condition. The
  Verilog-2001 list that holds it is on p.229, and the conditions are Ch.10's note (p.278) and Table 25
  (p.249): a variable base with a constant power is supported, `3 ** sw` is not. `94` probes the first.

Tried, and dropped:
- Starting a part-assigned register with `force` and `release` on the whole variable: iverilog 13 left the
  register bits at `z` after the release ("procedural continuous assignments are not yet fully
  supported"). Bit selects work.
- Choosing the variables to start bit by bit from their declaration's text (how many packed dimensions it
  has): a comma list, `logic [1:0][3:0] a, b;`, hides them from `b`. iverilog names exactly the variables
  it refuses, so the bench is written again with those.
- Keeping the excuse per compare and requiring only every bit known in the sim copy: the flipped digit
  counter's sim copy has no `x` output at any compare (the `case` default is a constant), so it still
  passed.
- Pressing only `btn*` and letting the switch-reset state machine fail: round 4's reason for the press (a
  student presses reset after loading the board) holds for a switch too.
- Sweeping `13d`'s 432 flips against every grid value and every row and column, one netlist copy per
  flip: 432 copies times 1048576 cases was too slow for this machine; the 18 survivors were instead checked
  by recording which input combinations of their LUT ever occur over the same 1048576 cases (7 s).

Found and left to later updates (reproduced, not fixed here):
- #3: `93`, the tie-break that builds another module than the project's top with no message (the CLI has
  to stop and name both, or say which it took and why); the block RAM of `97` is not timed, next to round
  6's registered DSP48E1.
- #4: `94` (the `$pow` cell), `96` and `96b` (the XDC check's port names); `95`, `98` and `99` if Vivado
  builds them.
- #5: "the design does not fit" for `94` and `95` (a `$pow` cell, an empty module's blackbox: neither is a
  size problem), the same message's "with -nobram every memory becomes LUTs" (false for `97`), `98`'s
  error inside `cells_sim.v` with no line of the student's file and no fix, `99`'s syntax error with no
  fix.
- #6: a falling-edge design's clock named on the pnr line by a cut internal name (`31b`: `pnr ok: 11 LUT,
  5 FF, 337:slice$1535.C': 358.68 MHz`: the awk cuts the name at its first colon), next to round 6's
  garbled names.

**What the breakers tried that held.** Every round, the breakers also reported what they tried and could
not break. Those runs are part of the evidence, so they are listed here, round by round.
- Round 1.
  - The runner's numbers: the full probe run and `test/run.sh` gave the score line and the stage counts
    these notes then printed (rtl 35/8, synth 32/11, netlist 28 pass, 4 fail, 11 not run, bit 32/11;
    Vivado column 36, 2, 5), under macOS's `/bin/bash` 3.2 too. The old runner's numbers (33/43, 35/43,
    29/33) match its saved result file.
  - Mutations the suite caught: every LUT INIT set to 0 (19 probes fail at the netlist stage; the other
    9 have no LUT cells), `--fix-ports` off (`08`), `create_clock` uncommented (the warning quoted above),
    `-g2005`, an expectation flipped, a probe folder without a row, malformed rows, the header renamed, the
    netlist `PASS` check dropped (`05` and `33` BAD with the measured yosys), `--prefer-tb` removed from the
    CLI (`26` BAD), a home-folder path planted in a probe (the hygiene check FAILs). All 8 flip-flop INIT
    flips in `37`'s netlist were caught.
  - Sources: the UG901 v2023.2 and v2022.2 and UG953 v2022.2 pages cited then were opened and hold (one
    breaker downloaded UG953 from xilinx.com; its sha256 equals the copy used here), and so do the corpus
    Vivado log quotes of `01`, `02`, `07`, `08` and `32`. `03`, `03b`, `04` and `05` staying unverified is
    right: no UG901 text on them, and no corpus log with Synth 8-91, 8-6859 or MDRV-1.
  - Designs a student writes that passed all four stages: a BCD converter with `/` and `%` (every value 0
    to 9999), bits of one output from two `always_ff` and an `always_comb`, Verilog-2001 non-ANSI ports with
    `defparam`, a net declaration assignment and `{cout, sum}` on the left, a RAM filled by an `initial`
    loop and then written, a blocking temporary inside `always_ff`, a `localparam` in the parameter port
    list, a compilation-unit `typedef struct` and `enum` as port types, a function with a loop and a local,
    `/` and `%` by a variable. Two `assign`s to one wire stop in nextpnr (not silent; the message is #5's).
  - 28 corpus testbench pairs gave the same waveforms on the RTL and the product's netlist; the 3
    differences were testbench races (stimulus on the clock edge) or `x` at time 0. The sweep stopped at
    folder 39, where one VCD reached 532 MB on this 8 GB machine.
  - The product did not change (`bin/`, `templates/`, `sim/` equal to HEAD), and the 89 corpus lab folders
    give the same results before and after: 8 build (2 by `dewfpga bit` alone, 6 with a top the harness
    named; round 7), the same error lines, only their order changed in two
    folders (the Python set, above).
  - CI's log of the last pushed commit shows yosys 0.68+post and Icarus 13.0; the 43 match under the
    YoWASP build of 0.68. The Homebrew bottle itself was not run here.
  - Privacy: no corpus owner name, no home-folder path; `06` is a reduced rewrite of a lab, not a copy;
    `ci.yml` parses and the npm package is unchanged (`test/` is not in its `files`).
- Round 2.
  - Designs that passed every stage, the equivalence check included: a full-case `always_comb` without a
    default, `unique case` without a default, an unpacked array with a pattern initializer and `assign
    segs = '{...}`, `$countones`, `$onehot`, `$onehot0`, a default port value left unconnected, a packed
    union, `const`, a real `localparam` converted to an integer, a file-scope enum whose names do not clash,
    a file-scope function, a `$readmemb` ROM from a `.txt` file with asynchronous and synchronous reads, a
    CRLF XDC and a CRLF source with the course's `dp` line, the course's exact seven-segment port line with
    its trailing comment. A signal declared and never assigned gets yosys' "used but has no driver"
    warning (Vivado warns too, Synth 8-3848 in 2 corpus logs; the message has no `file:line`).
  - The Harris and Harris testbench style (`$readmemb` vectors, `assert ... else $error`) reports a
    mismatch with its `file:line` and exit 2. 3 real corpus labs that build (a Gray counter, a multi-digit
    display, a traffic-light FSM): `eqv.py` PASS against the product's netlist. 21 corpus xsim elaboration
    logs, each module set run through `dewfpga sim`: only the known classes failed (`38`, `34`, a
    testbench without `$finish`, two roots).
  - Mutations the suite caught: the netlist stage without its `PASS` check (`39`), the unnamed-instance
    line off by one (`02`, `40`), `exact=0`, regressions turned into notes under yosys 0.68 (`st_stale`), the
    row-count check removed with a malformed row, the old personal-path grep, `--fix-ports` off, every LUT
    INIT 0 (19), `-g2005` (37 of 51), the sim built with `-s $(TOP)` (`07`, `09`), a broken `16c`. 60 LUT
    flips over `13`, `15`, `21`, `29`, `32`: 58 caught; the one `29` survivor also passes 65536 cycles.
  - The regression breaker ran HEAD and the tree side by side: 51 passed before; 86 passed with 23 gaps
    after, all 51 old checks among them; the corpus identical but for the error order in three folders.
    They recounted the table, re-ran `30`'s LUT flip (the same two lines), the source mutations (122 killed,
    32 survived) and 372 distinct LUT flips of their own (42 survive, every one explained above), and
    re-read the UG901 and UG953 pages and the corpus quotes: all hold. `test/run.sh`'s install check
    points the Homebrew link at whichever copy runs it (known; restored after every run).
- Round 3.
  - Designs that passed sim, bit and the equivalence check: a declaration in an unnamed `begin` block,
    `#(W = 4)` without the `parameter` keyword, a `localparam` in the header list, `repeat (2)`, C-style
    `logic [3:0] mem [16]`, a packed union, `$countones`, `$onehot`, `$onehot0`, `$countbits`, `$high`,
    `$low`, `$size`, `$left`, a task with output arguments, a file-scope packed struct as a port type, an
    implicit net in a port connection, `byte`, `shortint`, `int unsigned`, default port values, `const`, a
    struct bitstream cast, a positional pattern `'{a, b}`, a constant function in a `localparam`, a
    function that reads a module variable inside `always_comb`, `defparam`, `initial if (W < 1)
    $error(...)`, `unique0 case`, `wire logic` and `var logic`. Blocking and nonblocking assignments mixed on
    one variable in `always_ff`: EQV PASS.
  - `37`'s power-up values reach the bitstream: the FASM's ZINI bits match the 8 flip-flop INITs. A
    combinational design with `create_clock` uncommented only warns and writes its `.bit`. Immediate
    asserts that fail in a testbench exit 2 with the `file:line`.
  - The equivalence check on all 30 probes whose netlist then passed: 25 PASS, and the 5 skipped are the
    ones the notes named. Every output bit of the 25 is compared at least once (a per-bit counter). The
    slowest bench runs 4.5 s against the runner's 30 s limit. Corpus: 38 lab tops EQV PASS; two mismatches
    come from registers the RTL leaves `x`, judged not synthesis faults but not proved cycle by cycle.
  - Mutations the suite caught with the measured yosys: the comparison removed (`03`), the netlist's
    `PASS` check dropped (`39`), no button presses (`03`).
  - The regression breaker: the corpus through HEAD and the tree with a fixed hash seed, 0 differences;
    99 passed with 41 gaps, all 51 old checks among them; 69 of 69 under yosys 0.68 with the same rows;
    every quoted message found in the stage logs; the UG901 and UG953 pages and the corpus quotes of `01`,
    `38`, `53` and `54` hold; round 2's testbenches of `41`, `43`, `47`, `49` and `50` walk every input and
    tell the construct from its misreading. Not re-run by them: rounds 1 and 2's source-mutation counts,
    the 236-flip totals, and which synthesis run `57`'s bitstream came from.
- Round 4.
  - All 92 probes under yosys 0.68 (the YoWASP shim) and natively: 92 of 92 match, the same score line
    (11 min 49 s and 6 min 31 s). Only `32` has start-value differences. The slowest bench takes 6 s.
  - Constructs that passed all four stages: `const`, a packed union, an array pattern assigned to a
    variable, a default port value left unconnected, a bitstream cast `s_t'(v)`, `$countones`, `$onehot`,
    `$onehot0`, `$countbits`, `$size`, `$high`, `$low`, `$left`, `$right`, `$dimensions`,
    `$unpacked_dimensions`, `$increment`, `defparam`, `repeat (3)`, `` `default_nettype none ``, `$error` in
    an `initial` on a parameter, `$fatal` in a generate `if`, `bufif1` to a pin, a constant function in a
    `localparam`, a `localparam` in the parameter header, an enum variable without a typedef, a packed 2-D
    port, `$rtoi($ceil($log10()))` and `$sqrt` in parameters, `16'(2 ** sw[3:0])`, `/` and `%` of two
    variables, `always_ff @(negedge clk)` (FDRE_1 and CLKINV in the FASM), a RAM filled by an `initial`
    loop, `$readmemb("rom.data")`.
  - Corpus: every lab folder through `dewfpga bit` and `eqv.py`: 21 EQV PASS, 2 start-value artifacts (a
    ROM default of `x`, a counter with no start value clocking a register that has one), 1 with no known
    output bit; no synthesis fault.
  - Mutations that changed no verdict then and were not reported: FDSE and FDPE not started at 1 (the old
    excuse hid it; round 4 then removed the excuse), the negedge compare dropped, the "nothing compared"
    guard dropped (pinned in round 6). Caught: 256 cycles (`dense`, `sparse`), the port-line fix taking
    the first direction (`08`), the CLI ignoring `.v` files (`74`). A reset tied off in each flip-flop with
    a driven reset or set pin (55 faults over 21 and 12 clocked probes, 37 of which change the board): the
    testbenches catch all 37; only the equivalence check missed them (the round's high break). No false
    fail on `33b` or on a combinational design with buttons.
  - The regression breaker: 119 passed with 56 gaps; one summary line; the corpus unchanged but for one
    folder's error order; the table, the arithmetic of the notes and the 0.68 rows recounted; `75` reaches
    33.61 MHz; the UG901 pages of `52` to `80` and the v2022.2 cites of `13b`, `42`, `48` and `66` hold;
    slang's table names 9.4.2.3 and its test is `always @(a iff enable == 1)`; the corpus quotes of `53`,
    `54`, `75`, `76` and `77` hold; nextpnr-xilinx writes an `x` bit of a LUT INIT as 0; `git ls-files`
    lists all 193 probe files (none ignored, so CI gets them); no corpus owner name, checked one at a time.
- Round 5.
  - Designs that passed every stage: `$countones`, `$onehot`, `$onehot0`, `2**sw[3:0]`, `/` and `%` by a
    variable, `===` and `!==`, `$size`, `$left`, `$right`, `$high`, `$low`, `$rtoi($sqrt)`, `$ceil` and
    `$pow` in localparams, `defparam`, `repeat (8)`, `assign #5`, `<= #1`, `and #2`; signed `/`, `%`,
    `>>>`, `*`, compare and `**` on all 65536 inputs (equal except divide by zero, where the RTL is `x`);
    `$floor`, `$ln`, `$log10`, `$exp`, `$sin`, `$cos`, `$atan2`, `$hypot`, `$asin`, `$countbits`,
    `$increment`, `$dimensions`, `$unpacked_dimensions`; a default port value, a packed union, `const`, a
    bitstream cast, an enum in a numeric expression, a constant function; two `always_comb` sharing a
    module-level `integer`; an `initial` loop RAM with a later write; an output port with an initializer;
    register-file writes `mem[a][3:0] <=` and `mem[a][b] <=`; an unconnected submodule input (0, as in
    Vivado); an ascending `output logic [0:6] seg` (the routed `seg[0]` lands on W7, as the XDC says); a
    button as a clock, with and without `CLOCK_DEDICATED_ROUTE FALSE`; a gated clock; a testbench that
    ends in `$stop`; the Harris and Harris testbenches; an `inout` tristate in a submodule on `JA`. A
    non-constant `$clog2` stops `bit` with a `file:line`; what Vivado does with it is not verified.
  - Corpus: `dewfpga sim` on 55 testbench targets, 18 pass, the rest the known classes or student bugs;
    36 designs EQV PASS against the product's netlist. The Gray counter one clock behind after power-up
    was noted and not reported then; round 6 fixed the bench for it.
  - Mutations: `eqv.py` with a binary walk, reset values ignored, `$sdff` not started, no button presses
    after the start, the reset press without a clock edge, 1024 cycles, 15 exhaustive bits, pins never
    driven, only the RTL's 1 bits compared, enum starts off, a latch started at its preset, modules not
    renamed, every flip-flop INIT `x` set to 0: each killed by a case. No data compare: `33b` fails.
    Equivalent or dead, not reported: `hdlname` ignored, the all-0 and all-1 modes dropped, one edge's
    compare dropped, 4001 cycles, a button rate of 1/2. Not verified then: FDSE_1 and FDPE_1 entries, the
    memory start, the `assigned_in` bypass (round 6 pinned the last two).
  - LUT flips in the 10 probes whose comparison is skipped: the testbenches catch every flip that changes
    the netlist (`55`'s 11 and `73`'s 3 survivors each match the unflipped netlist). A source-operator
    sweep over the 62 probes whose rtl passes left only equivalent mutants and known cases.
  - The regression breaker: 138 passed with 63 gaps (791 s at a load of 17 to 27); the rows equal the
    table; 100 of 100 under yosys 0.68 with the same rows; the timeout margin (slowest 3.53 s); the UG901
    cites of round 4's rows; nextpnr's `fasm.cc` lines 811-825; the corpus quotes of `53`, `54`, `57` and
    `75`; `81` and `26` reproduced; the guide's HTML equal to a rebuild; no names; the 25 corpus files with
    the course's `logic dp` line all read after `--fix-ports` except one whose module name starts with a
    digit (invalid anyway).
  - Not verified by them: what Vivado does with a typedef header included by two files, with `output logic
    Cout; reg Cout;`, and with a testbench that assigns a variable a DUT output drives.
- Round 6.
  - Designs that passed: `CLOCK_DEDICATED_ROUTE FALSE` on a button clock; a CRLF XDC with
    `create_clock` (16 of the 37 corpus XDCs are CRLF); `create_clock` in a design with no `clk`; `const`,
    `union packed`, `unique0 case`, a default port value, `defparam`, `var logic`, an enum in arithmetic; a
    constant function without `return` (with it, the `16b` class); `initial if (N > 8) $error(...)` while
    false; an unconnected submodule input; a function reading a module variable in `always_comb`; vector
    bits driven from `assign` and `always_comb`, from two `always_comb`, from `always_ff` and `assign`;
    registered 16x16 and 32x32 multiplies (their timing is the DSP break above); negedge registers read by
    posedge ones (CLKINV); an ascending `[0:6]` port (13 corpus files use it); `$readmemh` with a Windows
    path (both stop with `design.sv:3`); a gated clock `clk & sw[15]`; the Table 21 math functions in
    localparams. A parameterized interface passed to a port builds right and fails in sim (`22`'s class);
    `initial q = $random;` stops with no `file:line` (`77`'s class); a top in two files is the known
    two-files class.
  - Corpus: 31 lab folders (41 roots) through `dewfpga bit` and `eqv.sh`: EQV PASS except the Gray counter
    and the dot-matrix project (both fixed this round), one empty stub and 12 skips (`38`'s class,
    redeclared ports). Testbench constructs `$urandom_range`, `$sformatf`, queues, dynamic arrays,
    `fork`/`join`, `wait`, `final` and `.name()` pass sim; `%p`, associative arrays and `std::randomize`
    fail in iverilog (0 corpus uses).
  - Mutations caught: memory words started at 1 (`28`), the data compare removed (`33b`). Equivalent or
    dead today: one edge's compare, LUT or RAM INIT `x` set to 1, the `INIT_` prefix, `upto`, the start
    delay, the `top` attribute (all 200 `x` INITs in the 57 product netlists are FDRE, FDCE, FDPE or LDCE).
    The newer testbenches (`41` to `88`, 18 read) each tell the construct from its obvious misreading.
  - The regression breaker: `bin/` and `templates/` equal to HEAD; 51 passed before, 148 with 77 gaps
    after; the corpus the same (the three folders whose error order differs also differ between two runs
    of the same CLI); 115 of 115 under yosys 0.68; the table's counts, the probe layout (one design file with
    `module top`, a `tb.sv` with `module tb`), the corpus logs of `08c` and `13d`, the UG901 rows of the
    round-5 probes, and the guide's HTML (equal to a rebuild) and PDF (13 pages) all hold.

**Tests.** `test/run.sh`: 51 passed, 0 failed before #2 (78 s); `passed 94, failed 0` after #2's first
draft (228 s). After break round 1: `passed 86, failed 0, known gaps 23` (356 s). After break round 2:
`passed 99, failed 0, known gaps 41` (305 s). After break round 3: `passed 119, failed 0, known gaps 56`
(409 s). After break round 4: `passed 138, failed 0, known gaps 63` (556 s). After break round 5:
`passed 148, failed 0, known gaps 77` (474 s). After break round 6: `passed 166, failed 0, known gaps 82`
(533 s; the final run of that round, 528 s, the same). After break round 7: `passed 178, failed 0, known
gaps 87` (583 s). The 178 are the 51 from before, 4 hygiene checks, 24 checks of the probe runner
itself, 54 checks of `eqv.py` and `eqv.sh`, and the 45 probes that are not known gaps (round 4: `63`
stopped being a gap and the 8 new probes were all gaps; round 5: of the 15 new probes, 14 are gaps and
`84` passes; round 6: of the 8 new probes, 5 are gaps, and `63b`, `91` and `92` pass; round 7: of the 9
new probes, 5 are gaps, and `31b`, `95`, `98` and `99` pass). The final run on 26 September, after these
notes were written: `passed 178, failed 0, known gaps 87` (582 s), the same (evidence below).
- `personal-path check sees test/sv/run.sh`: a home-folder path planted in a copy's `test/sv/run.sh` has to
  be found; `personal-path check sees test/run.sh` (round 7) plants one in `test/run.sh`, which the check
  skipped whole until then.
- `no names from student code in expect.tsv`: no quoted `module '<name>'`, `` `\name' `` or `(name_reg)`
  in the source column; `student-name check sees a quoted name` plants all three and has to find each
  (round 4 added the `` `\name' `` plant), and a quoted name after each of the pattern's 10 words (round
  6).
- The runner checks, each on a copy of the product with one thing broken, running one probe: a stale
  `top_sim` that prints `PASS` next to a broken `09` (the run has to say `rtl fail`); `05` recorded as
  refused under a yosys that is not the measured one (the run has to report a new silent wrong); `07`'s
  netlist recorded as failing (the run has to fail on the unexpected pass; only with the measured yosys);
  `26` with an empty source (refused); the CLI's latch error moved to line 1 (the run has to say
  `expect.tsv says design.sv:3, no stage printed it`). Round 2 added: `16c` broken so its testbench
  prints `FAIL` (has to be `rtl fail`); a probe folder with no row (refused); a `dewfpga bit` that exits
  0 and deletes `top.bit` (has to be `bit fail`); `01`'s column set to `not supported`, then
  `unverified` (both refused); `14` broken in the top finder, run through the runner and `test/run.sh`'s
  row check (the runner's row has to say `bad`, its exit code has to be non-zero, and the row check has
  to print `FAIL`); six hand-written rows (a `bad` row fails, and so do an `ok` whose stages differ from
  `expect.tsv`, an `ok` for a silent wrong, an `ok` for a supported probe that fails a stage, and an exit
  code that does not fit the rows; a clean row passes). Round 3 added, both under a yosys that is not the
  measured one: `07` with a netlist that differs from its RTL and a testbench that sees nothing (has to be
  `netlist fail, expected pass`), and `54` the same with its own testbench, where the comparison is
  skipped (the same); and a check that the runner checks write nothing to `GITHUB_STEP_SUMMARY`. Round 4
  added: the score line counted again from two hand-written rows (the right line passes; each of four
  wrong numbers fails); the latch error's advice replaced (`01` has to say `expect.tsv quotes 'Give q a
  default value at the top of the block.', no stage printed it`); the CLI made to skip `.v` files (`74`
  has to say `expect.tsv says design.v:3, no stage printed it`). Round 5 added: the unnamed-instance fix
  replaced (`02` has to say `expect.tsv quotes 'Write:  inv u_inv(', no stage printed it`: a quote in
  `"..."`); `01`'s vivado column written `Supported` (refused as a malformed row). Round 6 added: `04`'s
  dual-edge advice replaced in the product (`04` has to say `expect.tsv quotes 'Drive each signal from
  one always block.', no stage printed it`: a row's second quote); `76`'s second `file:line` made wrong
  (`expect.tsv says design.sv:9, no stage printed it`); `07`'s bench made not to compile (`netlist fail,
  expected pass`: an `eqv.sh` exit 1 is a fail); and, with the measured yosys and iverilog, a
  hand-written `ok` row for `07` against a table that records its netlist as failing (has to `FAIL`).
  Round 7 added: `07`'s testbench made to call `$error` and still print `PASS` (`dewfpga sim` exits 1;
  has to be `rtl fail`); and, in the score check, a runner log with no score line and one that writes
  `Synthesis` (each has to fail).
- `eqv.py: ...` and `eqv.sh: ...` (54 checks): `test/sv/eqv_check.sh` with equal, `msb`, `zero`, `walk`,
  `cbutton`, `ones`, `dense`, `sparse`, `deep`, `button`, `zout`, `xout`, `init`, `fdse`, `ldpe`,
  `ldfill`, `lostinit`, `xstart`, `fillset`, `fillaset`, `pkenum`, `enum1`, `lostreset`, `recode`,
  `hier`, `hierfault`, `names`, `ioequal`, `ioread`, `iofloat`, `mealyb`, `xstarta`, `xstartl`,
  `fillasym`, `subreg`, `subfault`, `regport`, `regslice`, `alias`, `enum1sub`, `enumstart`,
  `memstart`, `datasw`, `nobench`, `pkgfile`, `nothing`, `romstart`, `mixstart`, `simflip`, `simlost`,
  `xhold`, `swreset`, `partassign`, `negset` (round 4 added 15 and changed `deep`, `button`, `xstart`
  and `recode`; round 5 added 7, and every case now runs the runner's own `eqv.sh`; round 6 added 11;
  round 7 added the last 6 and built the reset of `xstart`, `fillset`, `fillaset`, `xstarta` and
  `fillasym` from two switches).
- `unnamed instance -> line and fix` (one of the 51) now also looks for the fix, `Write:  sub u_sub(`;
  it looked for the line only (round 5).

The four stages today, before #3 and #4 change anything:

| | rtl | synth | netlist | bit |
|---|---|---|---|---|
| pass, the 43 from 2509 | 35 | 32 | 27 | 32 |
| pass, the 51 after round 1 | 37 | 35 | 28 | 35 |
| pass, all 69 | 49 | 38 | 30 | 37 |
| fail, all 69 | 20 | 31 | 8 | 32 |
| not run (no netlist), all 69 | | | 31 | |
| pass, all 92 | 60 | 47 | 37 | 44 |
| fail, all 92 | 32 | 45 | 10 | 48 |
| not run (no netlist), all 92 | | | 45 | |
| pass, all 100 | 62 | 52 | 39 | 49 |
| fail, all 100 | 38 | 48 | 13 | 51 |
| not run (no netlist), all 100 | | | 48 | |
| pass, all 115 | 68 | 57 | 42 | 53 |
| fail, all 115 | 47 | 58 | 15 | 62 |
| not run (no netlist), all 115 | | | 58 | |
| pass, all 123 | 75 | 62 | 45 | 57 |
| fail, all 123 | 48 | 61 | 17 | 66 |
| not run (no netlist), all 123 | | | 61 | |
| pass, all 132 | 84 | 69 | 49 | 60 |
| fail, all 132 | 48 | 63 | 20 | 72 |
| not run (no netlist), all 132 | | | 63 | |

- The 43: synthesis 32/43, all four stages 24/43 (25 before the netlist was compared with the RTL; `03`
  moved), Vivado-supported probes passing all four 23/36.
- The 51 after round 1: synthesis 35/51, all four stages 24/51, Vivado-supported probes passing all four
  23/43, known gaps 24 (`13b` became supported in round 2: 23/42 and 23 before).
- All 69 after round 2: synthesis 38/69, all four stages 24/69, Vivado-supported probes passing all four
  23/60, known gaps 41.
- All 92 after round 3: synthesis 47/92, all four stages 26/92, Vivado-supported probes passing all four
  25/77, known gaps 56.
- All 100 after round 4: synthesis 52/100, all four stages 26/100, Vivado-supported probes passing all
  four 25/84, known gaps 63. (`63` moved from supported to unverified: 25/76 on round 3's 92.)
- All 115 after round 5: synthesis 57/115, all four stages 27/115, Vivado-supported probes passing all
  four 26/99, known gaps 77. The one new probe that passes all four is `84` (a constant `repeat`).
- All 123 after round 6: synthesis 62/123, all four stages 29/123, Vivado-supported probes passing all
  four 28/105, known gaps 82. The new probes that pass all four are `91` (a submodule in its own file)
  and `92` (a `$display` in a design module); `63b` fails where Vivado is unverified.
- All 132 after round 7: synthesis 69/132, all four stages 30/132, Vivado-supported probes passing all
  four 29/111, known gaps 87. The new probe that passes all four is `31b` (falling-edge registers); `95`,
  `98` and `99` fail where Vivado is unverified.
- The old runner (yosys called directly): synthesis 33/43, rtl 35/43, netlist 29/33.
- The 82 Vivado-supported probes that fail a stage are our gap (77 of 105 after round 6, 73 of 99 after
  round 5, 59 of 84 after round 4):
  - synth, yosys refuses: `01` latch in always_comb, `02` unnamed instance, `11` enum methods, `12b`
    assignment patterns, `12c` an array of structs indexed by a signal, `13b` unpacked array port, `13c`
    unpacked array concatenation, `16b` return, `16c` while loop, `22e` a modport expression, `23`/`23b`
    packages, `23e` a package that exports a name, `41` `==?`, `43` foreach, `44` do-while, `45` break,
    `47` type parameter, `49` default argument, `50` argument by name, `51` unpacked array localparam,
    `51b` packed 2-D localparam, `53` async reset with a synchronous clear, `56` a file-scope enum named
    `S0`, `60` pass by reference, `61` enum ranges, `62` the type operator, `64` an unpacked struct,
    `64b` an unpacked union, `65` a streaming target, `67` array equality, `68` an array slice, `69`
    disable, `82` `$fopen`/`$fdisplay`/`$fwrite` (UG901: Ignored), `83` `$realtobits`/`$bitstoreal`,
    `90` `$warning` in an `initial` parameter check,
    `85` a bitstream cast, `86` `extern module`, `87` a `config`, `88` a class's static function (`02`,
    `12b`, `13c`, `22e`, `51`, `51b`, `60`, `62`, `64`, `64b`, `65`, `67`, `68`, `83`, `85`, `86` and `88`
    fail rtl too);
  - the CLI's scanner stops sim and bit: `23d` header import, `40` a module named `display`, `40b` a
    module name and `(` inside a `$display` string, `57` a course module in netlist form, `78` UG901's
    keep_hierarchy attribute;
  - the CLI reads every file as SystemVerilog: `74` a Verilog-2005 `.v` file;
  - the CLI leaves a file out: `22b` interface file (rtl: iverilog syntax error; bit: yosys does not find
    the interface), `23c` package file (sim fails; bit builds a wrong bitstream), `56b` a file of
    file-scope typedefs (sim and bit stop at the first use, and neither names the file);
  - the CLI's top finder: `26`; its port-line fix: `08b`; its XDC check: `96` a one-bit vector port,
    `96b` a port numbered from 1;
  - place and route: `52` internal tristate (`$_TBUF_`), `33c` tristate buffers in submodules driving
    an output port (`$_TBUF_`), `70` wor/wand (`$and`, `$or`), `94` a variable base with a constant
    power (`$pow`);
  - timing: `75` misses 100 MHz; Vivado writes the bitstream, the CLI does not. `89` logic on a divided
    clock, which Vivado does not time: with no `create_clock` the CLI checks every clock at 100 MHz;
  - rtl, iverilog 13 refuses: `08c` a port with only a range written in an always block (`bit` writes its
    direction in, `sim` does not), `13d` a packed 2-D array indexed by a variable, then a bit or part
    select, `18b` unique if, `18c` unique0 if, `21b` an assignment inside an
    expression, `22` modport ports, `38` gate primitives driving `logic`, `54` a name used before its
    declaration, `71` a whole-array assignment, `72` a void function with outputs, `73` an array
    argument;
  - rtl, no UNISIM models in iverilog: `34` BUFG, `35` MMCM (`35`'s netlist too, no model in yosys'
    `cells_sim.v`);
  - netlist, no model in yosys' `cells_sim.v`: `97` UG901's `ram_style = "block"` (a RAMB18E1);
  - netlist (silent wrongs): the members of an interface instance used from the module that
    instantiates it, `22c` (with ports), `22d` (an array of interfaces), `22f` (no ports); `33` a pin
    the design sets to a constant `z` and reads (round 6: this said "inout read-back", but reading back
    a bidirectional pin works, `33`'s `JA[0]` and `33b`); `51c` a packed 2-D localparam whose type is a
    typedef (yosys builds the table as zeros),
    `58` a hierarchical name, `59` `$isunknown`, `81` a design module that calls `$finish` (the CLI takes
    it for a testbench and builds its submodule), `93` two roots, one named like its own file (the CLI
    builds that one, not the project's top);
  - `63` (`int'` of a real) was in the synth list until round 4 made it unverified.
- Silent wrongs, where the bitstream builds and the netlist fails: `03`, `03b`, `05`, `22c`, `22d`, `22f`,
  `23c`, `33`, `37b`, `39`, `51c`, `58`, `59`, `81`, `93` (15). They are #3's, except `23c`, which #4's
  package work closes. Two more rows build a bitstream whose netlist fails, `35` and `97`, for lack of a
  model, not because they are known to be wrong; the runner counts all 17 alike (round 7: these notes and
  the plan said 14 and left `35` out).

**Every probe.** The 132 folders of `test/sv`, from the final run's rows (they equal `expect.tsv`). Per
probe: the id, Vivado's status (`supported`, `not supported`, `unverified`), the verdict (`ok`: does what
the table says and is not a known gap; `gap`: a known gap), the stages that fail, the runner's note if any,
the construct, and where the Vivado status comes from. "Vivado 2020.1 log" is a Vivado log in a public
CS223 (or CS-224) lab repo or in the course's example project, quoted in `expect.tsv` without the
student's names; UG901 is the Vivado synthesis guide, UG953 the 7-series primitive guide. `expect.tsv`
holds the full quote for every source and what the student sees today. Summary: 45 `ok`, 87 `gap`; 111
supported, 3 not supported, 18 unverified.
```
01_latch_comb                supported     gap  fails: synth, bit (netlist not run)
    always_comb with an if and no else (a latch is inferred)
    source: Vivado 2020.1 log; UG901 v2023.2 p.84
02_unnamed_inst              supported     gap  fails: rtl, synth, bit (netlist not run)
    module instance with no instance name: inv(sw[0], led[0]);
    source: Vivado 2020.1 log
03_async_reset_nonconst      unverified    gap  fails: netlist
    always_ff @(posedge clk or posedge btnC) if (btnC) q <= sw[3:0]; (async load from a signal)
    source: UG901 v2023.2 p.81-82
03b_async_reset_selfref      unverified    gap  fails: netlist
    a button used as an async 'reset' that loads cnt+1 (the button-as-clock counter)
    source: UG901 v2023.2 p.81-82
04_dual_edge                 unverified    ok   fails: synth, bit (netlist not run)
    always @(posedge clk or negedge clk) cnt <= cnt + 1;
    source: UG901 v2023.2 p.81; forum posts (weak source)
05_two_block_driver          unverified    gap  fails: netlist
    one reg written from two always blocks on different edges (posedge btnU / posedge btnC)
    source: forum posts (weak source)
06_missing_end_default       not supported ok   fails: rtl, synth, bit (netlist not run)
    a case item's begin (S2: begin) never closed before default: (invalid code; a typo seen in a
    CS223 lab)
    source: IEEE 1800-2017 A.6.7
07_enum_packed_array         supported     ok   passes all four
    packed array of enums: statetype [1:0] state, nextstate;
    source: Vivado 2020.1 log; UG901 v2023.2 p.285
08_port_dir_inherit          supported     ok   passes all four
    ANSI port inheriting its direction: output [6:0] seg, logic dp, (the course's seven-segment
    file)
    source: Vivado 2020.1 log
08b_port_dir_comment         supported     gap  fails: synth, bit (netlist not run)
    the course's port line (output [6:0] seg, logic dp) with comments in the port list: one after
    seg, one with a ';' in it
    source: Vivado 2020.1 log; IEEE 1800-2017 5.4
08c_port_dir_inherit_proc    supported     gap  fails: rtl
    the course's port line shape with a range only, written in an always block: output logic [6:0]
    seg, [3:0] an; with an set in an always_comb
    source: Vivado 2021.2 log; IEEE 1800-2017 23.2.2.3; slang
09_always_procs              supported     ok   passes all four
    always_ff / always_comb / always_latch
    source: UG901 v2023.2 p.286
10_enum_fsm                  supported     ok   passes all four
    typedef enum FSM with an explicit base type and with the default (int), plus a light_t'(l+1)
    cast
    source: UG901 v2023.2 p.285
11_enum_methods              supported     gap  fails: synth, bit (netlist not run)
    enum methods s.first() / s.next() / s.last()
    source: UG901 v2023.2 p.285
12_struct_packed             supported     ok   passes all four
    typedef struct packed, nested, member read and write
    source: UG901 v2023.2 p.285
12b_struct_assign_pattern    supported     gap  fails: rtl, synth, bit (netlist not run)
    named assignment pattern '{hi: x, lo: y} and '{default: 0}
    source: UG901 v2023.2 p.286
12c_struct_array_var_index   supported     gap  fails: synth, bit (netlist not run)
    a packed array of structs indexed by a signal, then a member select: cars[sw[15]].x
    source: UG901 v2023.2 p.285, p.287
13_arrays_multidim           supported     ok   passes all four
    packed 2-D, unpacked, unpacked 2-D arrays, for (int i..) in always_comb
    source: UG901 v2023.2 p.285
13b_unpacked_array_port      supported     gap  fails: synth, bit (netlist not run)
    an unpacked array as a module port: input logic [3:0] v [0:3]
    source: UG901 v2023.2 p.161, p.162, p.164; UG901 v2022.2 p.160-162; IEEE 1800-2017 A.1.3
13c_unpacked_array_concat    supported     gap  fails: rtl, synth, bit (netlist not run)
    an unpacked array concatenation: assign arr = {sw[3:0], sw[7:4]}; to logic [3:0] arr [0:1]
    source: UG901 v2023.2 p.286
13d_packed_2d_var_index      supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    a packed 2-D array indexed by a variable, then a bit or part select: grid[i][j] <= ... in a
    loop, grid[sw[13:12]][3:1]
    source: UG901 v2023.2 p.285; Vivado 2019.1 log
14_params                    supported     ok   passes all four
    typed parameters, one depending on another, localparam, #(.W(8),.K(3)) and positional #(4)
    source: UG901 v2023.2 p.288
15_generate                  supported     ok   passes all four
    generate for with genvar (named block), for (genvar j..) with if-generate, case-generate
    source: UG901 v2023.2 p.288
16_func_task                 supported     ok   passes all four
    function automatic with a loop, plain function, task automatic called in always_comb
    source: UG901 v2023.2 p.287
16b_func_return              supported     gap  fails: synth, bit (netlist not run)
    'return expr;' inside a function
    source: UG901 v2023.2 p.287
16c_while_loop               supported     gap  fails: synth, bit (netlist not run)
    while loop in an always block (UG901 example)
    source: UG901 v2023.2 p.257, p.258
17_clog2_bits_cast           supported     ok   passes all four
    $clog2 in a localparam and a range, $bits, size cast 4'(expr)
    source: UG901 v2023.2 p.240, p.285
18_unique_priority           supported     ok   passes all four
    unique case / priority casez
    source: UG901 v2023.2 p.287, p.279; UG901 v2022.2 p.290
18b_unique_priority_if       supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    unique if / priority if
    source: UG901 v2023.2 p.287
18c_unique0_if               supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    unique0 if: an if/else if chain where no branch may match
    source: UG901 v2023.2 p.287
19_casez_casex               supported     ok   passes all four
    casez with ? wildcards, casex
    source: UG901 v2023.2 p.279
20_inside                    not supported ok   fails: rtl, synth, bit (netlist not run)
    set membership: x inside {1,3,[8:10]} and case (x) inside
    source: UG901 v2023.2 p.287; UG901 v2022.2 Table 8-1
21_incdec_assignops          supported     ok   passes all four
    x++ and x += in always_comb, k++ inside always_ff, for (int i..;i++) with c++
    source: UG901 v2023.2 p.286
21b_assign_in_expr           supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    an assignment within an expression: a = (b = sw[3:0]) + 4'd1; in always_comb
    source: UG901 v2023.2 p.286
22_interface_modport         supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    interface with two modports, modport-typed module ports (sum_if.prod bus)
    source: UG901 v2023.2 p.288, p.283-284
22b_interface_own_file       supported     gap  fails: rtl, synth, bit (netlist not run)
    an interface declared in its own file (sum_if.sv), generic interface ports
    source: UG901 v2023.2 p.288
22c_interface_ports          supported     gap  fails: netlist
    an interface with ports, interface cnt_if(input logic clk, input logic en), holding a counter;
    top reads c.q
    source: UG901 v2023.2 p.288
22d_interface_array          supported     gap  fails: netlist
    an array of interfaces: pair_if p [0:1] (); p[0].d and p[1].d driven and read in top
    source: UG901 v2023.2 p.288
22e_modport_expression       supported     gap  fails: rtl, synth, bit (netlist not run)
    a modport expression: modport lo (input .nib(data[3:0])); a submodule reads b.nib
    source: UG901 v2023.2 p.288; IEEE 1800-2017 25.5.4; slang
22f_interface_member_access  supported     gap  fails: netlist
    an interface without ports whose members the module that instantiates it drives and reads:
    add_if bus (); assign bus.a = sw[7:0]; ... led = bus.s
    source: UG901 v2023.2 p.288, p.282
23_package_import            supported     gap  fails: synth, bit (netlist not run)
    package (enum, parameter, localparam, function) + import pkg::*; inside the module + pkg::NAME
    source: UG901 v2023.2 p.288, p.284
23b_package_file_import      supported     gap  fails: synth, bit (netlist not run)
    the same package with import pkg::*; at file level, using an imported typedef
    source: UG901 v2023.2 p.288, p.284
23c_package_own_file         supported     gap  fails: rtl, netlist
    a package in its own file (pkg.sv), referenced as cfg_pkg::NAME
    source: UG901 v2023.2 p.288
23d_package_header_import    supported     gap  fails: rtl, synth, bit (netlist not run)
    import in the module header: module top import pkg::*; (...)
    source: UG901 v2023.2 p.288
23e_package_export           supported     gap  fails: synth, bit (netlist not run)
    a package that exports a name it imported: package p2; import p1::K; export p1::K; endpackage,
    and import p2::* in the module
    source: UG901 v2023.2 p.288
24_preproc_include           supported     ok   passes all four
    `include of a .svh, `define with arguments, `ifdef/`ifndef/`else, +: part select
    source: UG901 v2023.2 p.239
25_port_conn_dotstar         supported     ok   passes all four
    .* and .name implicit port connections
    source: UG901 v2023.2 p.281-282, p.287
26_inst_array                supported     gap  fails: synth, bit (netlist not run)
    array of instances: inv u_inv [3:0] (.a(sw[3:0]), .y(led[3:0]));
    source: UG901 v2023.2 p.239
27_readmemh_rom              supported     ok   passes all four
    ROM from initial $readmemh("rom.mem") with async and sync read
    source: UG901 v2023.2 p.240, p.155, p.177
28_dist_ram                  supported     ok   passes all four
    RAM: sync write, async read (distributed RAM, -nobram)
    source: UG901 v2023.2 p.114
29_shift_reg_srl             supported     ok   passes all four
    32-deep shift register (SRL) + dynamic tap sr[sw[8:4]]
    source: UG901 v2023.2 p.88, p.91
30_mult_signed               supported     ok   passes all four
    signed 8x8 multiply, >>> arithmetic shift, signed compare, $signed
    source: UG901 v2023.2 p.94, p.286, p.240
31_reset_styles              supported     ok   passes all four
    sync active-high reset, async active-low reset (negedge rst_n), async set to a nonzero constant
    source: UG901 v2023.2 p.81, p.82
31b_negedge_set              supported     ok   passes all four
    registers on the falling edge with no start value: a counter with a synchronous set (FDSE_1) and
    a bit with an asynchronous preset (FDPE_1), both reset from two switches
    source: UG901 v2023.2 p.81
32_clkdiv_7seg               supported     ok   passes all four
    clock divider making a derived clock (always_ff @(posedge slow)) + 4-digit 7-seg multiplexing +
    hex ROM via case
    source: Vivado 2020.1 log; UG901 v2023.2 p.81
33_tristate_pmod             supported     gap  fails: netlist
    inout JA: JA[0] = oe ? d : 1'bz and read back; JA[7:1] = 'z, JA[1] read as input
    source: UG901 v2023.2 p.86; UG953 v2022.2 p.386
33b_inout_read_only          supported     ok   passes all four
    inout pin only read (never assigned 'z) + one bidirectional pin
    source: UG901 v2023.2 p.86; UG953 v2022.2 p.386
33c_tristate_submodule_port  supported     gap  fails: netlist, bit
    the textbook's tristate buffer module (assign y = en ? a : 4'bz) instantiated four times, each
    driving one nibble of an output tri [15:0] port
    source: UG901 v2023.2 p.86
34_bufg                      supported     gap  fails: rtl
    UNISIM primitive instantiation: BUFG
    source: UG901 v2023.2 p.231-232; UG953 v2022.2 p.266
35_mmcm                      supported     gap  fails: rtl, netlist
    UNISIM MMCME2_BASE (100 to 50 MHz) + BUFG
    source: UG953 v2022.2 p.459; UG901 v2023.2 p.232
36_keep_attr                 supported     ok   passes all four
    (* keep = "true" *) and (* dont_touch = "true" *) on internal nets
    source: UG901 v2023.2 p.51, p.59
37_var_init                  unverified    ok   passes all four
    register power-up value: logic [3:0] cnt = 5; and initial c2 = 9;
    source: UG901 v2023.2 p.244, p.251, p.155
37b_decl_init_expr           unverified    gap  fails: netlist
    a variable declared with an initializer that reads inputs: logic [3:0] sum = sw[3:0] + sw[7:4];
    (meant as an adder)
    source: UG901 v2023.2 p.286, p.244; IEEE 1800-2017 6.8
38_gate_primitives           supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    gate primitives (not, and, or, xor) driving logic variables and an output logic port
    source: Vivado 2015.2 log; UG901 v2023.2 p.242
39_undeclared_name           unverified    gap  fails: rtl, netlist
    a typo: an undeclared name on the right of an assign (summ for sum)
    source: IEEE 1800-2017 6.10
40_display_module_name       supported     gap  fails: rtl, synth, bit (netlist not run)
    a module named display next to a $display call in a design module
    source: IEEE 1800-2017 A.1.2; UG901 v2023.2 p.239
40b_module_name_in_string    supported     gap  fails: rtl, synth, bit (netlist not run)
    a module name and ( inside a $display string in a design module: $display("counter (u_cnt)
    wrapped") next to module counter
    source: UG901 v2023.2 p.239; IEEE 1800-2017 5.9
41_wildcard_equality         supported     gap  fails: synth, bit (netlist not run)
    wildcard equality: sw[7:0] ==? 8'b1??0_??01 and !=?
    source: UG901 v2023.2 p.286
42_streaming_concat          not supported ok   fails: rtl, synth, bit (netlist not run)
    streaming concatenation: {<<{sw[7:0]}} (bit reverse) and {<<4{sw[15:8]}}
    source: UG901 v2023.2 p.287, p.286; UG901 v2022.2 p.289
43_foreach_loop              supported     gap  fails: synth, bit (netlist not run)
    foreach over an unpacked array in always_comb
    source: UG901 v2023.2 p.287, p.280
44_do_while_loop             supported     gap  fails: synth, bit (netlist not run)
    do ... while in always_comb, twice: a popcount, and a loop whose condition is false on entry
    (its body still runs once, which tells do-while from while)
    source: UG901 v2023.2 p.287, p.280
45_break                     supported     gap  fails: synth, bit (netlist not run)
    break out of a for loop in always_comb (lowest set bit)
    source: UG901 v2023.2 p.280, p.287
46_continue                  unverified    ok   fails: synth, bit (netlist not run)
    continue in a for loop in always_comb (count of set bits)
    source: UG901 v2023.2 p.287
47_type_param                supported     gap  fails: synth, bit (netlist not run)
    type parameter: module inv_t #(parameter type T = logic [3:0]), overridden with #(.T(logic
    [7:0]))
    source: UG901 v2023.2 p.285
48_iff_event                 unverified    ok   fails: rtl, synth, bit (netlist not run)
    iff event qualifier: always_ff @(posedge clk iff sw[15])
    source: UG901 v2023.2 p.286; IEEE 1800-2017 9.4.2.3; slang; UG901 v2022.2 p.288
49_default_arg               supported     gap  fails: synth, bit (netlist not run)
    function argument with a default value, called without it
    source: UG901 v2023.2 p.287
50_arg_by_name               supported     gap  fails: synth, bit (netlist not run)
    function arguments bound by name, in another order: diff(.b(x), .a(y))
    source: UG901 v2023.2 p.287
51_unpacked_param_array      supported     gap  fails: rtl, synth, bit (netlist not run)
    an unpacked array localparam set with an assignment pattern: localparam logic [6:0] SEGS [0:3] =
    '{...}
    source: UG901 v2023.2 p.285, p.286
51b_packed_param_array       supported     gap  fails: rtl, synth, bit (netlist not run)
    a packed 2-D localparam as a lookup table: localparam logic [3:0][6:0] SEG = {...}; seg =
    SEG[sw[1:0]];
    source: UG901 v2023.2 p.285
51c_packed_param_typedef     supported     gap  fails: rtl, netlist
    the same lookup table with its type named first: typedef logic [3:0][6:0] tab_t; localparam
    tab_t SEG = {...};
    source: UG901 v2023.2 p.285
52_internal_tristate         supported     gap  fails: netlist, bit
    an internal tri bus with two tristate drivers taking turns (the textbook's mux from tristate
    buffers)
    source: UG901 v2023.2 p.86
53_async_reset_sync_clear    supported     gap  fails: synth, bit (netlist not run)
    async reset ORed with a synchronous clear: always_ff @(posedge clk, posedge btnC) if (btnC ||
    btnU) q <= 0;
    source: Vivado 2021.2 log
54_use_before_decl           supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    a name used before its declaration: assign led[0] = stop; logic stop;
    source: Vivado 2017.3 log
55_enum_conditional          unverified    ok   fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    a conditional between two values of one enum: next = sw[0] ? RUN : IDLE;
    source: UG901 v2023.2 p.285; slang
56_unit_scope_enum           supported     gap  fails: synth, bit (netlist not run)
    typedef enum {S0, S1, S2} outside the module (compilation-unit scope), with the textbook's state
    names
    source: UG901 v2023.2 p.270, p.285
56b_unit_typedef_file        supported     gap  fails: rtl, synth, bit (netlist not run)
    a typedef at file scope in a file of its own (types.sv holds only typedef enum ... state_t;),
    used by the design's module
    source: UG901 v2023.2 p.270
57_ready_module_netlist      supported     gap  fails: rtl, synth, bit (netlist not run)
    a course 'ready module' in netlist form in its own file ((* keep_hierarchy *), \<const0>, GND,
    LUT2), instantiated by the design
    source: Vivado 2017.3 log
58_hier_name                 supported     gap  fails: netlist
    a hierarchical name that reads a submodule's signal: assign led[1:0] = u_fsm.state;
    source: UG901 v2023.2 p.239, p.288
59_isunknown                 supported     gap  fails: netlist
    $isunknown(sw) in a design (a real signal is never x, so it is 0)
    source: UG901 v2023.2 p.240
60_pass_by_ref               supported     gap  fails: rtl, synth, bit (netlist not run)
    a function with a ref argument: function automatic void inc(ref logic [3:0] x)
    source: UG901 v2023.2 p.287
61_enum_range                supported     gap  fails: synth, bit (netlist not run)
    enum ranges: typedef enum {S[3]} (S0, S1, S2) and {T[5:7]} (T5, T6, T7)
    source: UG901 v2023.2 p.285
62_type_operator             supported     gap  fails: rtl, synth, bit (netlist not run)
    the type operator: var type(a) b;
    source: UG901 v2023.2 p.285
63_real_cast                 unverified    ok   fails: synth, bit (netlist not run)
    a real localparam cast to int: localparam int INC = int'(STEP); (2.6 rounds to 3)
    source: UG901 v2023.2 p.285, p.273, p.286
63b_real_localparam_expr     unverified    ok   fails: synth, bit (netlist not run)
    a real literal in a localparam used in an expression: localparam MAX = 1e1; ... count == MAX - 1
    (a lab writes 50e6)
    source: UG901 v2023.2 p.285, p.273, p.286
64_unpacked_struct           supported     gap  fails: rtl, synth, bit (netlist not run)
    an unpacked struct: typedef struct { logic [3:0] a; logic [3:0] b; } (no packed)
    source: UG901 v2023.2 p.285
64b_unpacked_union           supported     gap  fails: rtl, synth, bit (netlist not run)
    an unpacked union: typedef union { logic [7:0] byte_v; logic [3:0] nib; } (no packed), one
    member written and read
    source: UG901 v2023.2 p.286
65_stream_unpack             supported     gap  fails: rtl, synth, bit (netlist not run)
    streaming concatenation as the target of an assignment: {>>{a, b}} = sw[7:0];
    source: UG901 v2023.2 p.287
66_alias                     unverified    ok   fails: rtl, synth, bit (netlist not run)
    alias a = b; (two nets made one)
    source: UG901 v2023.2 p.286; UG901 v2022.2 p.288-289
67_array_compare             supported     gap  fails: rtl, synth, bit (netlist not run)
    equality of two whole unpacked arrays: a == b, a != b
    source: UG901 v2023.2 p.285, p.286
68_array_slice               supported     gap  fails: rtl, synth, bit (netlist not run)
    a slice of an unpacked array: b = a[2:3];
    source: UG901 v2023.2 p.285
69_disable                   supported     gap  fails: synth, bit (netlist not run)
    disable of a named block to leave a loop (the lowest switch that is up)
    source: UG901 v2023.2 p.238
70_wor_wand                  supported     gap  fails: bit
    a wor and a wand net, two drivers each
    source: UG901 v2023.2 p.238
71_array_copy                supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    one whole unpacked array assigned to another in always_ff: b <= a;
    source: UG901 v2023.2 p.285
72_void_func_outputs         supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    a void function that returns through output arguments
    source: UG901 v2023.2 p.287
73_array_arg                 supported     gap  fails: rtl
    note: netlist: testbench only, iverilog cannot compile the RTL
    an unpacked array as a function argument
    source: UG901 v2023.2 p.285
74_verilog2005_file          supported     gap  fails: rtl, synth, bit (netlist not run)
    a .v design file with bit and final as names (keywords in SystemVerilog, names in Verilog 2005)
    source: UG901 v2023.2 p.269
75_timing_not_met            supported     gap  fails: bit
    a design that misses 100 MHz: a 14-bit value turned into four registered decimal digits (a long
    divide chain)
    source: Vivado 2015.2 log
76_implicit_net              supported     ok   passes all four
    names the standard declares implicitly: a net from a port connection (.y(w)) and one from the
    left of an assign (assign eq = ...)
    source: Vivado 2021.2 log; IEEE 1800-2017 6.10
77_initial_from_signal       unverified    ok   fails: synth, bit (netlist not run)
    an initial block that reads a signal: initial num = sw; (seen in a CS223 lab)
    source: UG901 v2023.2 p.251, p.244
78_keep_hierarchy            supported     gap  fails: rtl, synth, bit (netlist not run)
    (* keep_hierarchy = "yes" *) on a module, spaced as in UG901
    source: UG901 v2023.2 p.60
79_keep_hierarchy_nospace    supported     ok   passes all four
    the same attribute written without spaces: (*keep_hierarchy="yes"*) (yosys keeps the submodule)
    source: UG901 v2023.2 p.60
80_async_reset_trailing      unverified    ok   fails: synth, bit (netlist not run)
    an always_ff with an async reset and a statement after its if/else (d <= q; runs on the reset
    edge too)
    source: UG901 v2023.2 p.81-82
81_finish_in_design          supported     gap  fails: rtl, netlist
    note: the CLI took counter for the top
    a design module that calls $finish in a simulation check (always @(posedge clk) if (...)
    $finish;), its submodule's ports named as the XDC's (counter.sv)
    source: UG901 v2023.2 p.239, p.240
82_file_tasks_in_design      supported     gap  fails: synth, bit (netlist not run)
    file tasks left in a design module: $fopen, $fdisplay and $fwrite (a debug trace)
    source: UG901 v2023.2 p.239
83_realtobits                supported     gap  fails: rtl, synth, bit (netlist not run)
    $realtobits and $bitstoreal in localparams (a real turned into its IEEE 754 bits and back)
    source: UG901 v2023.2 p.240
84_repeat_const              supported     ok   passes all four
    a repeat loop with a constant count in always_comb (count the switches that are up)
    source: UG901 v2023.2 p.238
85_bitstream_cast            supported     gap  fails: rtl, synth, bit (netlist not run)
    a bitstream cast to an unpacked array: q = quad_t'(sw[7:0]); with typedef logic [3:0] quad_t
    [0:1]
    source: UG901 v2023.2 p.285
86_extern_module             supported     gap  fails: rtl, synth, bit (netlist not run)
    an extern module declaration ahead of the module: extern module inv4(input logic [3:0] a, output
    logic [3:0] y);
    source: UG901 v2023.2 p.287
87_config                    supported     gap  fails: synth, bit (netlist not run)
    a config declaration next to the design: config cfg; design work.top; default liblist work;
    endconfig
    source: UG901 v2023.2 p.239, p.288
88_class_static              supported     gap  fails: rtl, synth, bit (netlist not run)
    a class used for its static function, called as util::rev(sw[3:0]) (no object is made)
    source: UG901 v2023.2 p.288
89_clkdiv_slow_logic         supported     gap  fails: bit
    a clock divider's output clocks more logic than 100 MHz allows (four decimal digits of a 14-bit
    value on the slow clock); the XDC has no create_clock, as the course's master XDC arrives
    source: Vivado 2015.2 to 2021.2 routed timing reports (11 lab runs)
90_elab_warning_initial      supported     gap  fails: synth, bit (netlist not run)
    a parameter check in an initial block: initial if (N < 8) $warning(...)
    source: UG901 v2023.2 p.286, p.241
91_submodule_own_file        supported     ok   passes all four
    a design split over two files: top in design.sv, its submodule counter in counter.sv (the usual
    lab layout)
    source: UG901 v2023.2 p.270
92_display_in_design         supported     ok   passes all four
    a $display debug print left in a clocked design module: if (q == 4'd15) $display("wrapped");
    source: UG901 v2023.2 p.239
93_two_roots_file_name       supported     gap  fails: netlist
    note: the CLI took counter for the top
    two modules nothing instantiates, in one file named after one of them (counter.sv: the plain
    counter, and the board version the project names as its top)
    source: Vivado 2015.2 logs of two CS223 Lab 4 projects (.xpr and runme.log)
94_power_var_base            supported     gap  fails: bit
    a variable raised to a constant power: assign led = sw[7:0] ** 2;
    source: UG901 v2023.2 p.278, p.249
95_empty_submodule           unverified    ok   fails: netlist, bit
    a submodule declared with its ports and no body (a lab part not written yet), its output used
    source: none (no Vivado log; UG901 is silent)
96_port_one_bit_vector       supported     gap  fails: bit
    a port declared [N-1:0] with N = 1: a vector of one bit, numbered 0
    source: UG901 v2023.2 p.285; IEEE 1800-2017 7.4
96b_port_offset_range        supported     gap  fails: bit
    ports numbered from 1: input logic [4:1] sw, with the lab's own XDC (sw[1] to sw[4] only)
    source: UG901 v2023.2 p.285; IEEE 1800-2017 7.4
97_ram_style_block           supported     gap  fails: netlist
    UG901's RAM_STYLE attribute: (* ram_style = "block" *) on a 256-byte memory
    source: UG901 v2023.2 p.64
98_module_named_primitive    unverified    ok   fails: synth, bit (netlist not run)
    a student's module named like a Xilinx primitive: module INV (GND, VCC and MUXF7 too)
    source: UG901 v2023.2 p.232 (the guide is silent on the name)
99_string_parameter          unverified    ok   fails: synth, bit (netlist not run)
    a parameter of type string: parameter string INIT_FILE = "digits.mem" (a ROM's $readmemh file)
    source: UG901 v2023.2 p.285, p.238, p.247, p.232
```

**Does the suite catch breakage?** Each mutation below was made in a scratch copy and reverted.
- One bit of one LUT INIT flipped in the product's own netlists. Round 1's run drew 12 flips per probe
  with replacement (228 draws, some the same flip twice; its survivor list added up to 23, not the 24 it
  said). Round 2 drew distinct flips, 12 per probe or all a probe has, over the 30 probes whose netlist
  passes: 236 flips. The testbenches alone catch 101; round 1's `eqv.py` catches 171 and the new one the
  same 171; testbench and `eqv.py` together catch 209. Of the 27 left:
  - 6 are `55`'s, which has no `eqv.py` run (iverilog cannot compile its RTL, so only its testbench
    checks the netlist);
  - 11 are `10`'s, in LUTs that read the upper bits of its 32-bit `int` light (`l[27:24]`, `l[11:8]`, ...),
    which only ever holds 0 to 2;
  - 5 sit in combinational probes where the bench already compared every input: `16`'s 1 and `24`'s 2
    give the same outputs on all 65536 inputs, and `36`'s 2 are in the LUT that drives the kept net
    `mid`, which no output reads;
  - 5 are in clocked probes (`07`'s 1, `09`'s 1, `21`'s 2, `29`'s 1) and also pass a 65536-cycle run: LUT
    input combinations the design never reaches, read from the netlist, not proved.

  The new bench does not catch more of this sample; what it adds is shown by `eqv_check.sh` and by the
  breakers' flips (`21` at `sw = ffff` and at `7fff`), which the old one passed. Both are in the
  evidence below.

  Round 3 drew again, from `top.json`, 12 distinct flips per probe or all a probe has, over the 37
  probes whose netlist passes (25 of them have LUTs; this said 22 until round 4): 284 flips. The testbenches alone catch 154; round
  2's bench catches 199 and round 3's the same 199, so starting the netlist as the board does and
  counting `x` lost nothing here; together 253. Of the 31 left: 10 are `10`'s (its `int`, as above), 4
  `07`'s, 1 `09`'s, 2 `16`'s, 2 `24`'s and 2 `36`'s (as above: LUT input combinations the design never
  reaches, or a net no output reads), 4 `55`'s (all among the 11 of its 48 flips that do not change what
  its netlist does, see the break round), and 6 `75`'s. `75`'s testbench then checked 104 of the 16384
  values; it now checks every one, and on 60 other flips of `75` it catches 48 where the old one caught
  41. The 12 it passes cannot change a digit, because every value is compared.
- Source mutations of the 43 designs (one operator at a time, iverilog and the testbench): 113 killed, 42
  survived before; 122 killed, 32 survived after. The 32 left are listed under the break round.
- `--fix-ports` turned off: `08` fails, ``Module port `\dp' is neither input nor output``.
- `iverilog -g2005` in the sim rule (round 1, the 51): 37 of 51 probes fail. 36 fail at rtl: every probe
  whose rtl passes except `16c`, which is Verilog-2005 apart from `logic` and `'0`, and iverilog 13
  accepts those under `-g2005` with a warning. `22` fails because its rtl error moves from `design.sv:7`
  to `design.sv:1`.
- Every LUT's INIT set to 0 after synthesis (`setparam -set INIT 0 t:LUT*`), so the bitstream still
  builds (round 1, the 51): 19 probes fail, all at the netlist stage. The 9 other probes whose netlist
  passes have no LUT cells (INV, CARRY4, flip-flops, RAM, wiring).
- The runner itself: the five checks above. Forcing the runner's `exact=0` (the breaker's mutation) turns
  the unexpected-pass check red.
- Round 2, 15 mutations of the runner, `test/run.sh`'s row check and `eqv.py`, each on a copy of the
  fixed tree: every one turns at least one check red (list in the evidence below). Before round 2, each of
  the breakers' mutations here left the whole suite green.
- Round 3, 16 mutations of `eqv.py` and 4 of the runner, its checks and the port-line note, each on a
  copy: every one turns at least one check red (list in the evidence below). Before round 3, three of the
  breakers' netlist-stage mutations were caught by one probe, and only with the measured yosys (the
  comparison deleted: `03`; the testbench's `PASS` not required: `39`; no button presses: `03`), and four
  left the whole suite green (no exhaustive walk, no mostly-zeros values, a `z` counted as unknown, the
  port-line note one line down).
- Round 4, 17 mutations of `eqv.py`, each on a copy, against the 30 cases: every one turns at least one
  red (list in the evidence below). Before round 4, the breakers' `eqv.py` mutations (buttons out of the
  walk, pins never driven, pins not compared, 512 cycles) and their runner and check mutations (the
  score counted wrong, the latch advice replaced, `.v` dropped from the `file:line` pattern, the
  backquote dropped from the student-name pattern) each left the whole suite green. On the product's
  own netlists, a reset tied off in `09`, `10`, `21`, `31`, `32` or `34`: EQV PASS on round 3's bench,
  EQV MISMATCH now (each probe's testbench caught it already).
- Round 5, 8 mutations of `eqv.py` and `eqv.sh`, each on a copy, against the 37 cases, and 2 of the
  runner against its checks: every one turns at least one red (list in the evidence below). Before round
  5, each of the breakers' mutations left the whole suite green: no compare after the buttons change,
  async-reset flip-flops or latches not started, a reset value read in the other bit order, `flatten`
  dropped from the runner's register listing, the runner's `"..."` quote check and its vivado value check
  removed.
- Round 6, 12 mutations of `eqv.py` and `eqv.sh` against the 48 cases, 5 of the runner and `test/run.sh`
  against their checks, and 3 of the product or a probe against the probes: every one turns at least one
  red (list in the evidence below). Before round 6, each of the breakers' ones left the whole suite green:
  no start for a multi-bit enum or a memory, no data compare with a clock, `eqv.sh`'s bench guard, the
  `assigned_in` fallback, the packages-first order, the "nothing compared" fail, the runner's second
  quote, second `file:line` and exit-2 test, `sv_rows` always lenient, the name check cut to `module`,
  `sim` compiling one design file, `$print` kept for place and route, `44` read as a while loop.
- Round 7, 8 mutations of `eqv.py` against the 54 cases and 3 of the runner and `test/run.sh` against
  their checks: every one turns at least one red (list in the evidence below). Before round 7, the
  breakers' ones each left the whole suite green: the `x` test dropped from the sim-start excuse,
  `STARTS_AT_1` without `FDSE_1` and `FDPE_1`, the rtl stage's exit code not required, the score line
  not required, a home-folder path in `test/run.sh`. `13d`'s LUT INIT flips: 414 of 432 caught (308
  with the old testbench, the breaker's count), and the 18 left change nothing (above).
- Not caught: every LUT INIT stripped from the FASM before `fasm2frames` (the breaker's mutation): the
  bitstream loses its logic, and only the golden blink FASM, which is written before that step, is
  compared. See "Tried, and dropped".

**Evidence.**
```
$ test/sv/run.sh
test/sv: 51 probes, yosys 0.69+post, iverilog 13.0
  gap  01_latch_comb                rtl pass  synth fail  netlist -     bit fail
  gap  03_async_reset_nonconst      rtl pass  synth pass  netlist fail  bit pass
  ok   07_enum_packed_array         rtl pass  synth pass  netlist pass  bit pass
  gap  18b_unique_priority_if       rtl fail  synth pass  netlist pass  bit pass   note: netlist: testbench only, iverilog cannot compile the RTL
  ...
synthesis 35/51, all four stages 24/51, Vivado-supported probes passing all four stages 23/42, known gaps 23
matches expect.tsv: 51/51                                  (226 s)

$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh
test/sv: 51 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, iverilog 13.0: only regressions and new silent wrongs fail)
synthesis 35/51, all four stages 24/51, Vivado-supported probes passing all four stages 23/42, known gaps 23
matches expect.tsv: 51/51

$ SV_OUT=rows.tsv test/run.sh          (from a scratch folder; rows.tsv is there afterwards, 2279 bytes)
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS a build output left in a probe folder is not reused
  PASS a new silent wrong fails with any yosys
  PASS an unexpected pass fails with the measured yosys
  PASS a row without a Vivado source is refused
  PASS a wrong line in the latch error is caught
== SystemVerilog probes (test/sv)
  GAP  sv 01_latch_comb: rtl pass, synth fail, netlist -, bit fail
  ...
  PASS sv 07_enum_packed_array: rtl pass, synth pass, netlist pass, bit pass
  ...
passed 86, failed 0, known gaps 23

The same new checks run against the tree before this round: the old personal-path grep misses the
planted line, student names FAIL, stale top_sim FAIL (the run said "rtl pass"), new silent wrong FAIL (the
run said "note: ..." and exit 0), empty source FAIL, latch line FAIL. The unexpected-pass check passes
there too: it guards the runner's exact mode, which was already right.

The breaker's LUT flip in 30's netlist (32'd2720070586 -> 32'd2686516154); the old testbench printed PASS:
tb on the netlist: FAIL: >>>, $signed or signed < (sw=1410 seg=0000010, want sh=1 a<b=1)
EQV FAIL: 128 of 1507328 compared output bits differ between the RTL and the netlist
```

Round 2:
```
$ test/run.sh                                     (from a scratch folder, SV_OUT=rows-final.tsv)
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS a testbench that prints FAIL is an rtl fail
  PASS a probe folder without a row is refused
  PASS a bit run without top.bit is a bit fail
  PASS a vivado column its source does not back is refused
  PASS a probe that stops matching expect.tsv fails this suite
  PASS the verdict of each row is checked, not trusted
  PASS eqv.py: an equal netlist passes
  PASS eqv.py: a fault only on led[15] is caught
  PASS eqv.py: a fault only at sw=0000 is caught
  PASS eqv.py: a clocked fault only at sw=ffff is caught
  PASS eqv.py: a clocked fault only at sw=7fff is caught
  PASS eqv.py: a fault after 200 cycles is caught
== SystemVerilog probes (test/sv)
  GAP  sv 13b_unpacked_array_port: rtl pass, synth fail, netlist -, bit fail
  GAP  sv 52_internal_tristate: rtl pass, synth pass, netlist fail, bit fail
  PASS sv 55_enum_conditional: rtl fail, synth pass, netlist pass, bit pass (note: netlist: testbench only, iverilog cannot compile the RTL)
  GAP  sv 57_ready_module_netlist: rtl fail, synth fail, netlist -, bit fail
  ...
  synthesis 38/69, all four stages 24/69, Vivado-supported probes passing all four stages 23/60, known gaps 41
passed 99, failed 0, known gaps 41                          (305 s)

$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh
test/sv: 69 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
synthesis 38/69, all four stages 24/69, Vivado-supported probes passing all four stages 23/60, known gaps 41
matches expect.tsv: 69/69                                   (the row check on these rows: 28 passed, 0 failed, 41 gaps)

$ test/sv/eqv_check.sh <case>, with round 1's eqv.py and with mutations of the new one
round 1's eqv.py   equal ok   msb ok    zero RED  ones RED  dense RED  deep ok
compare bit 0      equal ok   msb RED   zero ok   ones ok   dense ok   deep ok
16 cycles          equal ok   msb ok    zero ok   ones ok   dense RED  deep RED
no corner values   equal ok   msb ok    zero ok   ones RED  dense RED  deep ok

The breakers' flips, round 1's eqv.py then the new one:
  sw=0000 only:  EQV PASS: 1048576 output bits compared   ->  EQV MISMATCH ... led[0] rtl 1, netlist 0; inputs sw=0000
  21 at ffff:    EQV PASS: 262024 output bits compared    ->  EQV MISMATCH ... led[11] rtl 0, netlist 1; inputs btnC=0 sw=ffff
  21 at 7fff:    (passed 4096 cycles)                     ->  EQV MISMATCH ... led[11] rtl 1, netlist 0; inputs btnC=0 sw=7fff

Mutations, each on a copy of the fixed tree, and the check that goes red:
  runner writes ok for bad          a probe that stops matching expect.tsv fails this suite
  row check files bad as gap        the verdict of each row is checked, not trusted
  row check drops the stage compare the verdict of each row is checked, not trusted
  row check ignores the exit code   the verdict of each row is checked, not trusted
  rtl without grep PASS             a testbench that prints FAIL is an rtl fail
  silent wrong not a gap            sv 05_two_block_driver: the runner says ok, but ... make it gap
  folder/row check removed          a probe folder without a row is refused
  synth read from the exit code     sv 52_internal_tristate: synth fail, expected pass
  bit without top.bit               a bit run without top.bit is a bit fail
  vivado column check removed       a vivado column its source does not back is refused
  student-name regex gutted         student-name check sees a quoted name
  eqv: bit 0 only / 16 cycles / walk from 1 / no corner values    eqv.py: msb / deep, dense / zero / ones, dense
The fixed tree without a mutation: all 13 of those checks pass.

Before and after, on the tree the breakers had:
  13b                                    PASS sv 13b_unpacked_array_port  ->  GAP  sv 13b_unpacked_array_port
  runner ok-for-bad + 14 broken          PASS sv 14_params, exit 0        ->  FAIL sv 14_params: the runner says ok, but its stages ... differ from expect.tsv
  silent wrong not a gap                 PASS sv 03_async_reset_nonconst  ->  FAIL sv 03_async_reset_nonconst: the runner says ok, but ... make it gap
```

Round 3:
```
$ GITHUB_STEP_SUMMARY=summary.md SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS a netlist that differs from its RTL fails, with any yosys
  PASS a testbench FAIL on the netlist fails, with any yosys
  PASS the runner checks leave CI's step summary alone
  ...
  PASS eqv.py: a fault only at sw=1234 is caught
  PASS eqv.py: a clocked fault only at sw=0100 is caught
  PASS eqv.py: a fault only while btnC is pressed is caught
  PASS eqv.py: an undriven (z) output is caught
  PASS eqv.py: an x output is caught
  PASS eqv.py: a register with INIT x starts at 0, as on the board
  PASS eqv.py: a start-value difference before the reset is apart
  PASS eqv.py: a kept submodule named as the RTL's passes
  PASS eqv.py: a fault inside a kept submodule is caught
== SystemVerilog probes (test/sv)
  GAP  sv 58_hier_name: rtl pass, synth pass, netlist fail, bit pass
  GAP  sv 59_isunknown: rtl pass, synth pass, netlist fail, bit pass
  GAP  sv 75_timing_not_met: rtl pass, synth pass, netlist pass, bit fail
  PASS sv 79_keep_hierarchy_nospace: rtl pass, synth pass, netlist pass, bit pass
  ...
  synthesis 47/92, all four stages 26/92, Vivado-supported probes passing all four stages 25/77, known gaps 56
passed 119, failed 0, known gaps 56                          (409 s)
$ cat summary.md                                              (one line; 8 before)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 47/92, all four stages 26/92, ...

$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh       (CI's yosys; brew untouched)
test/sv: 92 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
synthesis 47/92, all four stages 26/92, Vivado-supported probes passing all four stages 25/77, known gaps 56
matches expect.tsv: 92/92                                    (the only notes: 8 "testbench only")
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 15 cases>: 15 of 15 as expected

eqv.py mutations, each on a copy, and the eqv_check.sh cases that go red:
  exhaustive walk off (EXHAUSTIVE_BITS = 0)    walk
  no mostly-zeros values                        sparse
  no mostly-ones values                         dense
  buttons never pressed                         button
  a z counted as unknown                        zout
  an x counted as unknown                       xout
  INITs left x (no board start)                 init, xstart
  no start-value excuse                         xstart
  every 0/1 difference excused                  msb, zero, walk, ones, dense, sparse, deep, button, hierfault
  the excuse without its 0/1 test               xout
  only top renamed                              hier, hierfault
  cell types not renamed                        hierfault
  compare bit 0 only                            msb, zout, xout
  16 cycles                                     dense, sparse, deep
  walk from 1                                   zero
  no corner values                              ones, dense, sparse
The fixed eqv.py: all 15 cases pass.

The runner, and the checks that go red:
  netlist-vs-RTL comparison deleted (CI mode)   FAIL a netlist that differs from its RTL fails, with any yosys
  testbench PASS dropped from the netlist stage FAIL a testbench FAIL on the netlist fails, with any yosys
  the summary check on the round-2 tree         FAIL the runner checks leave CI's step summary alone (PASS now)
  the port-line note one line down              ok 08 on the round-2 tree -> BAD 08_port_dir_inherit ... expect.tsv says design.sv:2, no stage printed it

Before and after:
  79 on the round-2 tree   BAD 79_keep_hierarchy_nospace ... net_eqv.v:3: error: 'inv' has already been declared in this scope.  ->  ok
  the undriven led[4]      EQV PASS: 983040 output bits compared, all equal (65536 more were x in the netlist only)  ->  EQV MISMATCH at 3000 (gray): led[4] rtl 0, netlist x; inputs sw=0000
  55's 48 LUT flips        the old testbench passes 23 of the 36 that change the netlist  ->  the new one passes 0
```

Round 4:
```
$ GITHUB_STEP_SUMMARY=<absolute path> SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== static
  PASS student-name check sees a quoted name
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS the score line is counted again from the rows
  PASS a message the today column quotes is checked
  PASS a file:line of a .v file is checked
  ...
  PASS eqv.py: a packed array of enums with no start value is started
  PASS eqv.py: a 1-bit enum with no start value is started
  PASS eqv.py: a netlist that lost its reset is caught
  PASS eqv.py: a re-encoded state machine is compared after one reset
  PASS eqv.py: ports named x, mode, seed, r, n, v, k do not clash with the bench
  ...
== SystemVerilog probes (test/sv)
  PASS sv 07_enum_packed_array: rtl pass, synth pass, netlist pass, bit pass
  GAP  sv 13c_unpacked_array_concat: rtl fail, synth fail, netlist -, bit fail
  GAP  sv 18c_unique0_if: rtl fail, synth pass, netlist pass, bit pass (note: netlist: testbench only, iverilog cannot compile the RTL)
  GAP  sv 22c_interface_ports: rtl pass, synth pass, netlist fail, bit pass
  GAP  sv 22d_interface_array: rtl pass, synth pass, netlist fail, bit pass
  PASS sv 63_real_cast: rtl pass, synth fail, netlist -, bit fail
  GAP  sv 81_finish_in_design: rtl fail, synth pass, netlist fail, bit pass (note: the CLI took counter for the top)
  ...
  synthesis 52/100, all four stages 26/100, Vivado-supported probes passing all four stages 25/84, known gaps 63
passed 138, failed 0, known gaps 63                          (556 s)
$ cat summary.md                                              (GITHUB_STEP_SUMMARY=<absolute path>; one line)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 52/100, all four stages 26/100, Vivado-supported probes passing all four stages 25/84, known gaps 63
$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh <the 100, in four runs>          (CI's yosys; brew untouched)
test/sv: 25 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
matches expect.tsv: 25/25, 25/25, 25/25, 24/25    BAD 75_timing_not_met ... expect.tsv quotes 'ERROR: timing not met: 33.61 MHz (FAIL at 100.00 MHz)', no stage printed it
after the rewording, 75 under both:  gap  75_timing_not_met  rtl pass  synth pass  netlist pass  bit fail
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 30 cases>: 30 of 30 as expected
$ GITHUB_STEP_SUMMARY=<absolute path> test/sv/run.sh 07_enum_packed_array 81_finish_in_design; cat <that file>
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 2/2, all four stages 1/2, Vivado-supported probes passing all four stages 1/2, known gaps 1

$ test/sv/eqv_check.sh <case>, round 3's eqv.py (its argument count only widened) and today's
                 round 3                                                        today
names            eqv.sv:12: error: 'r' has already been declared in this scope.  EQV PASS: 98304 output bits compared, all equal
lostreset        EQV PASS: 262136 ... (31956 more differed only while a register had no start value)   EQV FAIL: 33108 of 262144 ...
lostinit         EQV PASS: 196608 ... (35328 more differed only while ...)       EQV FAIL: 35328 of 196608 ...
(the other 27 cases give the same verdict with both; they pin what round 3 left unpinned, below)

eqv.py mutations, each on a copy, and the eqv_check.sh cases that go red:
  no reset press before the first compare      recode
  every start value 0                          fillset fillaset
  no start values in the RTL                   xstart pkenum enum1
  LDPE starts at 1                             ldpe ldfill
  FDSE starts at 0                             fdse fillset
  FDPE starts at 0                             fillaset
  a latch's start taken from its preset        ldfill
  buttons out of the exhaustive walk           cbutton
  inout pins never driven from outside         ioread iofloat
  inout pins not compared                      iofloat
  512 cycles / 3999 cycles                     deep / deep
  buttons never pressed after the start        button
  netlist INITs left x                         init fdse ldpe ldfill xstart fillset fillaset pkenum enum1
  only top renamed                             hierfault
  every register set bit by bit (07's crash)   pkenum enum1
  a 1-bit enum not started                     enum1
Today's eqv.py: all 30 cases as expected.

The product's netlists with every reset/set pin that is not a constant tied to 0 (tb.sv on it; round 3's bench; today's):
  09  tb FAIL  EQV PASS: 262132 output bits compared, all equal (31956 more ...)   EQV MISMATCH at 28000 (data): led[0] rtl 0, netlist 1
  10  tb FAIL  EQV PASS: 262140 ... (20140 more ...)                               EQV MISMATCH at 28000 (data): led[4] rtl 0, netlist 1
  21  tb FAIL  EQV PASS: 262120 ... (96886 more ...)                               EQV MISMATCH at 28000 (data): led[0] rtl 0, netlist 1
  31  tb FAIL  EQV PASS: 262092 ... (96814 more ...)                               EQV MISMATCH at 28000 (data): led[0] rtl 0, netlist 1
  32  tb FAIL  EQV PASS: 196608 ... (46705 more ...)                               EQV MISMATCH at 36000 (posedg): an[0] rtl 0, netlist 1
  34  tb FAIL  EQV PASS: 196604 ... (24440 more ...)                               EQV MISMATCH at 14000 (btns): led[0] rtl 0, netlist 1

The runner and test/run.sh's row check over 07, 01, 52, 70, each with a mutated runner:
  round 3's tree, supported probes all counted as passing   passed 1, failed 0 (the line says 4/4)
  today, the same                                           FAIL sv: test/sv/run.sh says '... passing all four stages 4/4, known gaps 3', its rows make it '... 1/4, known gaps 3'
  today, synthesis counted from the bit stage               FAIL sv: test/sv/run.sh says 'synthesis 1/4, ...', its rows make it 'synthesis 3/4, ...'
  today, no mutation                                        passed 1, failed 0, known gaps 3

The latch advice replaced with 'something went wrong.':
  round 3's runner   gap  01_latch_comb   rtl pass  synth fail  netlist -  bit fail          matches expect.tsv: 1/1
  today's runner     BAD  01_latch_comb   ... expect.tsv quotes 'Give q a default value at the top of the block.', no stage printed it
Each mutation on a copy, the new check that goes red (all four green on round 3's suite):
  the backquote dropped from the student-name pattern   FAIL student-name check sees a quoted name
  .v dropped from the runner's file:line pattern        FAIL a file:line of a .v file is checked
  the runner's quote check removed                      FAIL a message the today column quotes is checked
  the runner counts every supported probe               FAIL sv: test/sv/run.sh says ... (the full run's row check, above)

81 with a runner that reads only top.json (round 3's), and today's:
  BAD  81_finish_in_design   rtl fail  synth fail  netlist -     bit fail   synth fail, expected pass; netlist -, expected fail; bit fail, expected pass
  gap  81_finish_in_design   rtl fail  synth pass  netlist fail  bit pass   note: the CLI took counter for the top
```

Round 5:
```
$ GITHUB_STEP_SUMMARY=<absolute path> SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== static
  PASS shellcheck                                                (now also test/sv/eqv.sh)
== error paths
  PASS unnamed instance -> line and fix                          (now also 'Write:  sub u_sub(')
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS a vivado value other than supported, not supported, unverified is refused
  PASS a message the today column quotes in double quotes is checked
  PASS eqv.py: an output lost only between a button change and the clock edge is caught
  PASS eqv.py: a register with an asynchronous reset starts in the RTL as on the board
  PASS eqv.py: a latch with no start value starts at 0 in the RTL, as on the board
  PASS eqv.py: a reset value of 0011 starts each bit as its FDSE or FDRE does
  PASS eqv.sh: a submodule's register with no start value is started in the RTL
  PASS eqv.sh: a fault in a submodule's register with no start value is caught
  PASS eqv.py: a register that feeds a submodule's port is started by its own name
== SystemVerilog probes (test/sv)
  GAP  sv 08c_port_dir_inherit_proc: rtl fail, synth pass, netlist pass, bit pass
  GAP  sv 51c_packed_param_typedef: rtl fail, synth pass, netlist fail, bit pass
  PASS sv 84_repeat_const: rtl pass, synth pass, netlist pass, bit pass
  ...
  synthesis 57/115, all four stages 27/115, Vivado-supported probes passing all four stages 26/99, known gaps 77
passed 148, failed 0, known gaps 77                          (474 s)
$ cat summary.md                                              (one line)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 57/115, all four stages 27/115, Vivado-supported probes passing all four stages 26/99, known gaps 77
$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh <the 15 new probes>     (CI's yosys; brew untouched)
test/sv: 15 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
matches expect.tsv: 15/15                                     (52 s)
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 37 cases>: 37 of 37 as expected (111 s)
$ test/sv/run.sh <the 115, in four runs of 29, 29, 29 and 28>
matches expect.tsv: 29/29, 29/29, 29/29, 28/28          (124 s, 105 s, 51 s, 55 s)

The breaker's probe 90_reg_to_port (register n feeds a submodule's port D; top also has a register D):
  round 4's runner   BAD  90_reg_to_port   rtl pass  synth pass  netlist fail  bit pass   netlist fail, expected pass
                              net:    eqv.sv:20: error: 'eqv_rtl.A1.D' is not a valid l-value for a procedural assignment.
  today's runner     ok   90_reg_to_port   rtl pass  synth pass  netlist pass  bit pass

The breaker's divider in a submodule, the product's netlist of a copy that counts down:
  round 4's runner, its eqv() as it is        EQV FAIL: 26112 of 196608 compared output bits differ between the RTL and the netlist
  round 4's runner, its eqv() without flatten EQV PASS: 147456 output bits compared, all equal
  today's eqv.sh                              EQV FAIL: 26112 of 196608 compared output bits differ between the RTL and the netlist

eqv mutations, each on a copy; the cases that go red. Round 4's tree ran its 30 cases plus the breakers' 4
(mealyb, xstarta, xstartl, fillasym added to it); today's tree runs its 37:
                                                    round 4's tree              today
  no compare after the buttons change (eqv.py)      mealyb (the 30: none)       mealyb
  async-reset flip-flops not started (eqv.py)       xstarta (the 30: none)      xstarta
  latches not started (eqv.py)                      xstartl (the 30: none)      xstartl
  reset value bits in the other order (eqv.py)      fillasym (the 30: none)     fillasym
  no flatten in the RTL register listing            none (it was in run.sh)     subfault (it is in eqv.sh)
  no proc in the RTL register listing (eqv.sh)                                  25 cases, subreg subfault regport among them
  the always block's module not looked at first                                 subreg subfault regport
  eqv.py --netlist skipped (INITs left x, modules not renamed)                   17 cases
Today's tree without a mutation: all 37 cases as expected (21 s).

The runner checks on a copy of today's tree with the breakers' runner mutations:
  "..." quotes not read from the today column   FAIL st_fixtext    (the run: gap 02_unnamed_inst ... matches expect.tsv: 1/1)
  the vivado value check removed                FAIL st_vivvalue   (the run: ok 01_latch_comb ... matches expect.tsv: 1/1)
On round 4's tree the same two mutations left the suite green: 02 'matches expect.tsv: 1/1' with the fix
text gone from the CLI, 01 'ok' with its column written 'Supported'.

The new probes' testbenches, each on a correct design and on one with its construct broken:
  08c  the line bit rewrites, iverilog   PASS    an = 4'b1110 for two digits          FAIL: sw=0100 an=1110 seg=1111111
  12c  iverilog                          PASS    .x and .y swapped                     FAIL: sw=0001 led=0001
  13d  yosys-slang netlist               PASS    sw[4*j + i] in the loop               FAIL: sw=0101 led=5005 want=1101
  13d  yosys-slang netlist               PASS    the two read indices swapped          FAIL: sw=1010 led=0010 want=1010
  23e  iverilog / yosys-slang            PASS    K = 6                                 FAIL: sw=0000 led=0006 (both)
  33c  iverilog                          PASS    4'b0 instead of 4'bz                  FAIL: sw=0000 led=0000
  40b  iverilog                          PASS    the counter steps by 2                FAIL: after 1 edges led=a5a2
  51b  yosys-slang netlist               PASS    two table entries swapped             FAIL: sw=0002 seg=0110000
  51c  yosys-slang netlist               PASS    two table entries swapped             FAIL: sw=0002 seg=0110000
  82   iverilog                          PASS    q + sw[4:1]                           FAIL: cycle 0 led=0002 want=4
  83   yosys-slang netlist               PASS    $realtobits(3.5)                      FAIL: sw=0000 led=400a
  83   yosys-slang netlist               PASS    $bitstoreal of 1.0                    FAIL: sw=0000 led=4000
  84   iverilog                          PASS    repeat (7)                            FAIL: sw=da80 led=da00
  85   yosys-slang netlist               PASS    quad_t [1:0] instead of [0:1]         FAIL: sw=c201 led=c201
  86   yosys-slang netlist               PASS    y = a                                 FAIL: sw=0000 led=0000
  87   iverilog                          PASS    the byte swap undone                  FAIL: sw=3c00 led=3c00
  88   yosys-slang netlist               PASS    rev returns a                         FAIL: sw=0101 led=0101

51c, the product's netlist and yosys-slang's, sw = 0 to 3 (the table: 1000000 1111001 0100100 0110000):
  dewfpga bit    pnr ok: 0 LUT, 0 FF ...    seg 0000000 0000000 0000000 0000000
  yosys-slang                               seg 1000000 1111001 0100100 0110000
```

Round 6:
```
$ GITHUB_STEP_SUMMARY=<absolute path> SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== static
  PASS student-name check sees a quoted name                     (now a quoted name after each of 10 words)
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS an unexpected pass in a row is not trusted with the measured yosys
  PASS a message the today column quotes second is checked
  PASS a file:line the today column names second is checked
  PASS a comparison that fails with exit 1 is a netlist fail
  PASS eqv.py: a register whose slice a wire names is started by its own name
  PASS eqv.py: a register with an alias wire that sorts first is started by its own name
  PASS eqv.py: 1-bit enums of a submodule and of the file are started
  PASS eqv.py: a 2-bit enum the netlist starts in a state the RTL never has is caught
  PASS eqv.py: a LUT RAM that powers up with the wrong contents is caught
  PASS eqv.py: an output lost only between a switch change and the clock edge is caught
  PASS eqv.sh: a bench that does not compile while the RTL does is a FAIL
  PASS eqv.sh: a package in its own file that sorts after the design is compiled first
  PASS eqv.py: a bench that compares nothing is a FAIL
  PASS eqv.py: a netlist one clock off at the start, as dewfpga sim shows it, passes
  PASS eqv.py: a netlist that mixes two starts in one compare is caught
== SystemVerilog probes (test/sv)
  GAP  sv 22f_interface_member_access: rtl pass, synth pass, netlist fail, bit pass
  GAP  sv 37b_decl_init_expr: rtl pass, synth pass, netlist fail, bit pass
  GAP  sv 44_do_while_loop: rtl pass, synth fail, netlist -, bit fail
  GAP  sv 56b_unit_typedef_file: rtl fail, synth fail, netlist -, bit fail
  PASS sv 63b_real_localparam_expr: rtl pass, synth fail, netlist -, bit fail
  GAP  sv 89_clkdiv_slow_logic: rtl pass, synth pass, netlist pass, bit fail
  GAP  sv 90_elab_warning_initial: rtl pass, synth fail, netlist -, bit fail
  PASS sv 91_submodule_own_file: rtl pass, synth pass, netlist pass, bit pass
  PASS sv 92_display_in_design: rtl pass, synth pass, netlist pass, bit pass
  ...
  synthesis 62/123, all four stages 29/123, Vivado-supported probes passing all four stages 28/105, known gaps 82
passed 166, failed 0, known gaps 82                          (533 s; rows-final.tsv has 123 rows)
$ cat summary.md                                              (one line)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 62/123, all four stages 29/123, Vivado-supported probes passing all four stages 28/105, known gaps 82
$ test/sv/run.sh <the 123, in four runs of 31, 31, 31 and 30>
matches expect.tsv: 31/31, 31/31, 31/31, 30/30          (136 s, 114 s, 39 s, 73 s)
synthesis 19+23+8+12 = 62/123, all four stages 12+12+0+5 = 29/123, supported and all four 28/105, known gaps 82
$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh <the 8 new probes and the 6 changed rows>     (CI's yosys)
test/sv: 14 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
matches expect.tsv: 14/14                                     (63b's crash quote removed first: 13/14 with it)
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 48 cases>: 48 of 48 as expected (152 s)

The breakers' netlists, round 5's eqv.sh, then today's:
  Gray counter (6 FDRE)   EQV FAIL: 9 of 36864 compared output bits differ between the RTL and the netlist
                          EQV PASS: 36864 output bits compared, all equal (at 9 compares to the RTL as dewfpga sim starts it, ...)
  enum in a submodule     EQV FAIL: the RTL compiles but the equivalence bench does not   (Unable to bind `eqv_rtl.OFF')
                          EQV PASS: 196608 output bits compared, all equal
  wire low = led[3:0]     EQV FAIL: the RTL compiles but the equivalence bench does not   ('eqv_rtl.low' is not a valid l-value)
                          EQV PASS: 262144 output bits compared, all equal
The breakers' netlists that have to fail, today's bench (the excuse passes none of them):
  enum state 11 at power-up   EQV FAIL: 2 of 196608 compared output bits differ between the RTL and the netlist
  28's RAM all ones           EQV FAIL: 4096 of 262144 compared output bits differ between the RTL and the netlist
  led[0] a constant 1         EQV FAIL: 3609 of 196608 compared output bits differ between the RTL and the netlist

The new eqv_check cases on round 5's eqv.py and eqv.sh (red = the case does not give its verdict):
  regslice alias enum1sub romstart                          red (the first three: the bench does not compile;
                                                            romstart: EQV FAIL: 21501 of 196608)
  enumstart memstart datasw nobench pkgfile nothing mixstart as expected (they pin what round 5 already did)

eqv mutations on a copy of today's tree, and the cases that go red (48 cases; none without a mutation):
  12 the multi-bit enum start deleted                  enumstart
  13 memories not started                              memstart
  14 no data compare with a clock                      enumstart datasw
  15 eqv.sh's bench guard removed                      nobench
  18 the assigned_in fallback removed                  regslice alias enum1sub
  22 the packages-first order removed                  pkgfile
  23 "nothing compared" no longer a FAIL               nothing
  the sim-start excuse removed                         romstart
  the excuse per bit, not per compare                  mixstart
  an x in the sim-start copy excuses                   subfault enumstart memstart
  the 1-bit enum item named in top's scope             enum1sub
  assigned_in reads whole lines, not columns           alias enum1sub
On round 5's tree the breakers' seven (12 to 23) each left all 37 cases green.

Runner mutations on a copy of today's tree, the old checks that could see them, and the new one:
  only a row's first quote is checked        PASS st_latchtext, PASS st_fixtext, FAIL st_quote2
  only a row's first file:line is checked    PASS st_latchline, PASS st_vfile, FAIL st_line2
  any eqv.sh failure is a skip (-ne 0)       PASS st_eqvpin, FAIL st_eqvexit
  sv_rows always lenient (exact=0)           PASS st_verdicts, PASS st_score, FAIL st_exact
  the name check's words cut to module       FAIL st_names

Product and probe mutations, the probe that goes BAD:
  sim compiles only the first design file    BAD 91_submodule_own_file  rtl fail, expected pass   (tb.sv:7: error: Unknown module type: top)
  delete t:$print dropped                    BAD 92_display_in_design   bit fail, expected pass   (no Bels remaining of type '$print')
  44's two do-while loops written as while   BAD 44_do_while_loop       rtl fail, expected pass
Before, no probe could see the first two (only 57 has two design files, and the CLI stops it; 40, 40b
and 81 never hand their $display to yosys); the breakers' full runs with them: passed 144, failed 0.
44 with its one loop written as while matched expect.tsv (gap, 1/1).

-noautowire, every probe read with and without it (hierarchy, proc): 22, 22b, 22c, 22d, 22f, 23c, 39, 58, 76
change; 63b crashes either way.

The new probes' testbenches, on the RTL (iverilog) and with one edit:
  89   PASS    d1 without % 10                       FAIL: value 9999: led=9979, want 9999
  89   PASS    the slow clock never toggles          FAIL: value 9999: led=0000, want 9999
  90   PASS    N = 5                                 FAIL: sw=0010 led=0010, want 0000
  63b  PASS    MAX = 1.2e1                           FAIL: after 10 edges led=0000
  37b  PASS    wire instead of logic (continuous)    FAIL: led follows sw (sw=0101 led=0001, was 0000): an initializer runs once
  22f  PASS    s = a - b                             FAIL: sw=0100 led=00ff
  91   PASS    the counter steps by 2                FAIL: after 1 edges sw=5e81 led=5e83
  92   PASS    the counter steps by 2                FAIL: after 1 edges sw=5e81 led=5e82
  56b  PASS    RUN goes back to IDLE                 FAIL: after 2 edges led=0000, want 2
  44   PASS    the second loop written as while      FAIL: do-while popcount, and a body that runs once (sw=8000 led=0001 want 1, 1)
```

Round 6's final run, 26 September (the tree after round 6):
```
$ GITHUB_STEP_SUMMARY=<absolute path> SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== static
  PASS shellcheck
  PASS no personal paths
  PASS personal-path check sees test/sv/run.sh
  PASS no names from student code in expect.tsv
  PASS student-name check sees a quoted name
  ...
== probe runner (test/sv/run.sh on a copy, one probe each)          71 PASS: 23 runner checks, 48 eqv checks
  ...
== SystemVerilog probes (test/sv)                                    41 PASS, 82 GAP, 0 FAIL
  GAP  sv 01_latch_comb: rtl pass, synth fail, netlist -, bit fail
  ...
  PASS sv 92_display_in_design: rtl pass, synth pass, netlist pass, bit pass
  synthesis 62/123, all four stages 29/123, Vivado-supported probes passing all four stages 28/105, known gaps 82

passed 166, failed 0, known gaps 82
real 527,76                                                           (exit 0; rows-final.tsv has 123 rows)
$ cat summary.md                                                      (one line)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 62/123, all four stages 29/123, Vivado-supported probes passing all four stages 28/105, known gaps 82

$ PATH=<yowasp yosys 0.68 shim>:$PATH SV_OUT=<chunk>.tsv test/sv/run.sh <25 ids>     (CI's yosys; brew untouched; 5 runs)
test/sv: 25 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, iverilog 13.0: only regressions and new silent wrongs fail)
matches expect.tsv: 25/25, 25/25, 25/25, 25/25, 23/23        (175 s, 149 s, 129 s, 61 s, 131 s; 0 BAD)
synthesis 14+16+14+6+12 = 62/123, all four stages 9+8+7+0+5 = 29/123,
Vivado-supported all four 9+8+6+0+5 = 28 of 20+24+19+21+21 = 105, known gaps 14+16+15+21+16 = 82
notes: 11 "netlist: testbench only, iverilog cannot compile the RTL", 1 "the CLI took counter for the top"
$ diff <the native rows, id to bit> <the 0.68 rows, id to bit>                          (identical, 123 rows)
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 48 cases>
as expected: 48 of 48; red: none                              (151 s)
$ readlink /opt/homebrew/bin/dewfpga; yosys -V
<the repo>/bin/dewfpga
Yosys 0.69+post (git sha1 143eb14f9cc55d6f8927e68523b0c9d2166ed02c, ...)
```

Round 7:
```
$ GITHUB_STEP_SUMMARY=<absolute path> SV_OUT=rows-final.tsv test/run.sh      (from a scratch folder)
== static
  PASS personal-path check sees test/run.sh                         (new)
== probe runner (test/sv/run.sh on a copy, one probe each)
  PASS a testbench that prints PASS while dewfpga sim exits 1 is an rtl fail      (new)
  PASS the score line is counted again from the rows                (now also: no score line, 'Synthesis ...')
  PASS eqv.py: a wrong netlist that matches sim's x-optimistic copy at some compares is caught
  PASS eqv.py: a netlist that shows only what sim shows while its register is x is caught
  PASS eqv.py: an x in sim's copy excuses no x in the netlist
  PASS eqv.py: a reset on a switch is pressed first, like a button
  PASS eqv.sh: a register that shares its variable with an assign is started
  PASS eqv.py: an FDSE_1 and an FDPE_1 with INIT x start at 1, as on the board
== SystemVerilog probes (test/sv)
  PASS sv 31b_negedge_set: rtl pass, synth pass, netlist pass, bit pass
  GAP  sv 93_two_roots_file_name: rtl pass, synth pass, netlist fail, bit pass (note: the CLI took counter for the top)
  GAP  sv 94_power_var_base: rtl pass, synth pass, netlist pass, bit fail
  PASS sv 95_empty_submodule: rtl pass, synth pass, netlist fail, bit fail
  GAP  sv 96_port_one_bit_vector: rtl pass, synth pass, netlist pass, bit fail
  GAP  sv 96b_port_offset_range: rtl pass, synth pass, netlist pass, bit fail
  GAP  sv 97_ram_style_block: rtl pass, synth pass, netlist fail, bit pass
  PASS sv 98_module_named_primitive: rtl pass, synth fail, netlist -, bit fail
  PASS sv 99_string_parameter: rtl pass, synth fail, netlist -, bit fail
  ...
  synthesis 69/132, all four stages 30/132, Vivado-supported probes passing all four stages 29/111, known gaps 87
passed 178, failed 0, known gaps 87                          (583 s; exit 0; rows-final.tsv has 132 rows, 178 PASS, 87 GAP, 0 FAIL)
  final run, after every file but these notes was written: the same, 582 s, the same 132 rows
$ cat summary.md                                              (one line)
SystemVerilog probes (yosys 0.69+post, iverilog 13.0): synthesis 69/132, all four stages 30/132, Vivado-supported probes passing all four stages 29/111, known gaps 87
$ SV_OUT=<chunk>.tsv test/sv/run.sh <the 132, in five runs of 27, 27, 27, 27 and 24>
matches expect.tsv: 27/27, 27/27, 27/27, 27/27, 24/24                (the first 118 s)
synthesis 15+19+13+10+12 = 69/132, all four stages 10+11+4+1+4 = 30/132,
Vivado-supported all four 10+11+3+1+4 = 29 of 22+26+21+23+19 = 111, known gaps 15+15+20+22+15 = 87
(the rows, id to bit, equal those of the full run)
$ PATH=<yowasp yosys 0.68 shim>:$PATH test/sv/run.sh <the 9 new probes and 13d>     (CI's yosys; brew untouched)
test/sv: 10 probes, yosys 0.68, iverilog 13.0  (expect.tsv was measured with yosys 0.69+post, ...)
matches expect.tsv: 10/10
$ PATH=<the same shim>:$PATH SV_OUT=<chunk>.tsv test/sv/run.sh <the 132, in the same five runs>
matches expect.tsv: 27/27, 27/27, 27/27, 27/27, 24/24        (193 s, 186 s, 115 s, 113 s, 117 s; 0 BAD)
synthesis 69/132, all four stages 30/132, Vivado-supported all four 29/111, known gaps 87 (the same sums)
notes: 11 "netlist: testbench only, iverilog cannot compile the RTL", 2 "the CLI took counter for the top"
$ diff <the native rows, id to bit> <the 0.68 rows, id to bit>                          (identical, 132 rows)
$ PATH=<the same shim>:$PATH test/sv/eqv_check.sh <each of the 54 cases>
as expected: 54 of 54; red: none                              (172 s)

The breakers' netlists, round 6's eqv.sh, then today's:
  digit counter, one LUT bit flipped   EQV PASS: 196608 output bits compared, all equal (at 3072 compares to the RTL as dewfpga sim starts it, ...)
                                       EQV FAIL: 3072 of 196608 compared output bits differ between the RTL and the netlist
  digit counter lost (led = 1111)      EQV PASS: 196608 output bits compared, all equal (at 9216 compares to the RTL as dewfpga sim starts it, ...)
                                       EQV FAIL: 9216 of 196608 compared output bits differ between the RTL and the netlist
  one-hot FSM, reset on sw[15]         EQV FAIL: 10 of 196608 compared output bits differ between the RTL and the netlist
                                       EQV PASS: 196608 output bits compared, all equal
  the same, reset on btnC              EQV PASS: 262144 output bits compared, all equal          (both)
  counter on led[3:0], assign the rest EQV FAIL: the RTL compiles but the equivalence bench does not
                                       EQV PASS: 262144 output bits compared, all equal
  the corpus Gray counter (6 FDRE)     EQV PASS: 36864 output bits compared, all equal (at 9 compares to the RTL as dewfpga sim starts it, ...)
                                       EQV PASS: 36864 output bits compared, all equal
  counter with no start, led[3:0] x    EQV FAIL: 49152 of 196608 compared output bits differ between the RTL and the netlist   (both)
  negedge set counter (FDSE_1, INIT x) EQV PASS: 196608 output bits compared, all equal          (both)

The new eqv_check cases on round 6's eqv.py and eqv.sh:
  simflip   red   EQV PASS: 196608 output bits compared, all equal (at 3072 compares ...)
  simlost   red   EQV PASS: 196608 output bits compared, all equal (at 9216 compares ...)
  swreset   red   EQV FAIL: 10 of 196608 compared output bits differ between the RTL and the netlist
  partassign red  EQV FAIL: the RTL compiles but the equivalence bench does not
  xhold negset    as expected (they pin what round 6 already did)
All 48 old cases on today's eqv.py and eqv.sh before the five were changed: 48 of 48 as expected (40 s).

eqv mutations on a copy of today's tree, and the cases that go red (54 cases; none without a mutation):
  the x test dropped from the sim copy's rule                   xhold
  STARTS_AT_1 without FDSE_1 and FDPE_1                         negset
  reset values ignored (every register started at 0)           fillset fillaset fillasym
      (the same with their resets still on sw[15]: all five green, the press hides the start)
  the sim copy counted as resolved from the start               simlost romstart
  the excuse per compare again                                  simflip simlost
  the excuse removed                                            romstart
  switch resets not pressed                                     swreset
  no bit-by-bit start (--bits ignored)                          partassign

Runner and test/run.sh mutations, the check that sees each:
  the rtl stage's exit code not required        st_rtlexit: PASS on the runner, FAIL on the mutant
                                                (the runner on 07 with the planted $error: BAD 07_enum_packed_array rtl fail)
  the runner prints no score line               sv_rows: 'test/sv/run.sh printed no score line, its rows make it
                                                'synthesis 1/2, ...'', fail=1 (round 6's sv_rows: fail=0)
  a home-folder path appended to test/run.sh    round 6's personal_paths: 0 lines; today's: 1 (test/run.sh:469)

13d's testbench, all 432 single-bit LUT INIT flips of the product's netlist, in one simulation (408 s):
  caught 414 of 432 (the breaker's count with the old testbench: 308)
  the 18 left: LUT _32_ (it drives led[12]) bits 6 7 12 13 14 15 18 19 22 23 24 25 26 27 28 29 30 31
  input combinations of _32_ that never occur, every grid value x every row and column (1048576 cases, 7 s):
                   6 7 12 13 14 15 18 19 22 23 24 25 26 27 28 29 30 31
  the breaker's flip (LUT 3, bit 27): old testbench PASS, new FAIL: grid=84f5 sw=c45a led=54f5 want=44f5

The new probes' testbenches, on the RTL (iverilog) and with one edit:
  93   PASS    the plain counter as top                FAIL: after 1 clocks led=1, want 0
  94   PASS    sw[7:0] ** 3                            FAIL: sw=0002 led=8 want 4
  94   PASS    sw[7:0] * 2                             FAIL: sw=0001 led=2 want 1
  95   PASS    led = {sw[14:0], b}                     FAIL: sw=0001 led=000X
  96   PASS    assign led = sw                         FAIL: 2 of 2
  96b  PASS    assign led = sw                         FAIL: 16 of 16
  97   PASS    writes the address, not the data        FAIL: address 0 led=0000
  97   PASS    reads the next address                  FAIL: address 0 led=000a
  98   PASS    INV passes a through                    FAIL: sw=0000 led=0000
  99   PASS    the ROM read at ~a                      FAIL: address 0 led=00a6
  31b  PASS    posedge instead of negedge              FAIL: the rising edge moved q: led=0000
  31b  PASS    the set loads 0                         FAIL: the set on the falling edge: led=0000
  31b  PASS    the preset loads 0                      FAIL: the preset, before any edge: led=0003

Measured apart for the new rows:
  93 as lab4.sv        ERROR: 2 modules could be the top (nothing instantiates them): counter, top. Name it:  dewfpga bit counter
  corpus 061 (its own XDC)   pnr ok: 6 LUT, 6 FF, 830.56 MHz (PASS at 100.00 MHz); the plain counter's .bit, exit 0, no 'top module:' line
  94 with 16'd3 ** sw[2:0]   the same 'no Bels remaining of type '$pow'' and 'does not fit'
  94 with 2 ** sw[3:0]       pnr ok: 16 LUT, 0 FF;   with sw[7:0] * sw[7:0]: pnr ok: 0 LUT, 0 FF (a DSP48E1)
  95 with b unused           pnr ok: 0 LUT, 0 FF, no clocked paths, timing not applicable
  96, nextpnr-xilinx on the product's top.json: Constraining 'led' to site 'IOB_X0Y3', 'sw' to 'IOB_X0Y11'
      (the sites of led[0] and sw[0] in a 16-bit design)
  96b, the same with its own XDC: exit 0, sw[1] to sw[4] on IOB_X0Y12, Y10, Y9, Y7 (the sites of sw[1] to sw[4])
  97 with rom_style = "block" on an initialized ROM: RAMB18E1: 1/150, pnr ok: 0 LUT, 0 FF, no clocked paths
  98 as GND, VCC, MUXF7: cells_sim.v:28, :24, :342: ERROR: Re-definition of module ...;  as BUF: pnr ok: 1 LUT
  99 untyped: pnr ok: 7 LUT, 0 FF; its netlist: the testbench PASS, EQV PASS: 1048576 output bits compared, all equal

The port-line fix (check_xdc.py --fix-ports) on eight placements of a comment, 1 = the line was fixed:
  // a comment after seg,  at the end of the seg, line                1   (the comment itself ends in a comma)
  // the segments          at the end of the seg, line                0
  // ...                   on a line of its own between the two       0
  /* ... */                on a line of its own between the two       0
  /* ... */                between seg, and logic dp on one line      0
  /* ; ... */              after seg,                                 0
  // ...                   after logic dp,                            1
  /* ... */                before the comma after seg                 1
```

**Not verified.**
- CI has not run this tree: the main session pushes it. Under CI's yosys the probes were checked with the
  YoWASP build of 0.68 (a scratch venv, Homebrew untouched), not the Homebrew bottle `0.68+post` that CI
  installs. `63b` crashes yosys 0.69+post and stops at an internal cell check under YoWASP 0.68; what the
  bottle does is not known, and the row quotes neither, so it holds either way.
- No board was plugged in during #2, so `dewfpga flash` was not run; `35_mmcm`'s bitstream in particular
  was never tried on a board.
- What Vivado does with the 18 unverified probes (`03`, `03b`, `04`, `05`, `37`, `37b`, `39`, `46`, `48`,
  `55`, `63`, `63b`, `66`, `77`, `80`, `95`, `98`, `99`): no Xilinx document or corpus log settles them;
  `04` and `05` have only forum sources.
- Which top Vivado picks by itself when two modules qualify and the project names none: the two corpus
  projects of `93`'s shape name theirs. How Vivado names the pins of a one-bit vector port (`96`): no
  corpus source uses one; the row rests on the guide and IEEE 1800.
- `97`'s block RAM, and a `rom_style = "block"` ROM, on a board: never flashed; that the netlist stage
  cannot check them is by construction (no model), not a sign they are wrong.
- Things the breakers tried whose Vivado side no source here shows: a typedef header included by two
  files, `output logic Cout; reg Cout;`, a testbench that assigns a variable a DUT output drives, a
  non-constant `$clog2`, two `assign`s to one wire.
- Which of the two synthesis runs in the course example project's log `57`'s bitstream came from.
- The two corpus designs whose netlist differs from the RTL only through registers the RTL leaves `x`
  (round 3): judged start-value artifacts, not proved cycle by cycle.

**Not done here.**
- The top finder on `26`, the constructs the probes record (now 82 Vivado-supported failures, `56b`,
  `90`, `94`, `96` and `96b` among them), and the XDC's `get_ports` wildcard and list forms: #4.
- The silent wrongs, `03`, `22c`, `22d`, `22f`, `37b`, `39`, `51c`, `58`, `59`, `81` and `93` included,
  the untimed DSP48E1 paths and block RAM (`97`), a module defined in two files, and the missing
  rebuilds: #3.
- The messages of `12c`, `33c`, `40b`, `52`, `53`, `70`, `77`, `80`, `85`, `94`, `95`, `98` and `99` (and
  the "with -nobram every memory becomes LUTs" of the "does not fit" message, false for `97`), iverilog's
  `repeat` warning (`84`), the awk program printed on a yosys crash (`63b`), two `assign`s to one `wire`, and the
  async-reset rule's advice for `80`: #5. The plan called that rule dead and had #5 delete it; the plan
  now says it is live (`80`), so #5 fixes its advice instead. (The guide's sections 7 and 8 now say what
  the CLI does today; #5 changes what it says.)
- `75`: Vivado writes the bitstream when timing fails; `CLAUDE.md` records "timing FAIL = hata". Which one
  wins is the owner's decision, and #4 is where it lands, with `89` (a divided clock checked at 100 MHz).
- A test that looks inside the bitstream, the garbled and the internal clock names on the pnr line
  (`31b`'s falling-edge clock too), and a Vivado-style testbench without `$finish`: #6.
- `dewfpga sim` with two design roots naming `dewfpga bit` in its advice: #12, with top selection.
- README, README.tr and the cli page still say "46 checks". #6 locks the number.
