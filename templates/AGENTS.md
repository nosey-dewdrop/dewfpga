# Working in this dewfpga project

This folder is a Digilent Basys3 (XC7A35T) design built with `dewfpga` on an Apple Silicon Mac, no Vivado:
SystemVerilog (`.sv`/`.v`); a testbench and an `.xdc` only when the user wants them. Guide and error pages:
https://nosey-dewdrop.github.io/dewfpga/ (machine index: https://nosey-dewdrop.github.io/dewfpga/llms.txt).

## One .sv is enough: never ask for a Makefile, an .xdc or a build script

`dewfpga run top.sv --build-only` builds; `dewfpga run top.sv` also programs the board (ONLY when the user
asks); `--top NAME` picks the top. `sw[15:0] led[15:0] btnC btnU btnD btnL btnR clk seg[6:0] dp an[3:0]` are
pinned automatically (a `top.xdc` beside it wins). The tools are installed; never install other FPGA tools.

## Folder commands (several files, a testbench, an `.xdc`; run inside this folder)

```
dewfpga sim   --json     # iverilog runs the testbench; exit 1 when it prints $error/$fatal
dewfpga bit   --json     # .sv -> <top>.bit (yosys, nextpnr-xilinx, prjxray); refuses to write .bit when timing is not met
dewfpga check --json     # is every tool in place
dewfpga tops             # list top candidates, writes nothing
dewfpga clean            # remove build outputs
dewfpga flash            # program the board over USB: ONLY when the user asks for it
```

`--json` prints exactly one JSON object (`schema` `dewfpga/result@1`) on stdout and nothing else;
`--timeout=<s>` caps the wall clock. Without `--json`, the same commands print text, one message per
problem in one format: `file:line: ERROR [code]: message Fix: ... https://nosey-dewdrop.github.io/dewfpga/errors/<code>/`.

| exit | meaning (JSON mode) |
|---|---|
| 0 | ok |
| 1 | design or project problem: read `diagnostics[]`, or `log.tail` when it is empty |
| 2 | usage: wrong option, command, or folder |
| 3 | toolchain missing or broken: `dewfpga install` fixes it, do not work around it in the design |
| 4 | board not found or not programmable |
| 124 | the command hit its wall-clock timeout |
| 70 | the wrapper itself failed |

## How to read a failure

1. Take `diagnostics[].code`, `file`, `line`, `message`, `fix`. Fix the first `ERROR`
   first: later ones often follow from it, but rerun before trusting the rest.
2. Open `diagnostics[].url` for that code when the fix line is not enough.
3. `artifacts[]` lists `<top>.bit`, the `.vcd` and the log, each with `state` new, cached or stale. A `stale`
   or `cached` `.bit` is not this run's: a build that stops before make (no `.xdc`, two tops) leaves the
   previous `.bit`; a failed synthesis or place-and-route removes it.
4. `log.tail` is the last lines of the text output; the full log is `log.path`.

## Rules

- Keep the design's behaviour and its ports: same names, widths and directions. Do not rename or
  re-pin anything in the `.xdc` unless the user asks; the pins are the board's wiring.
- The testbench must keep failing loudly: `$error` on a wrong value, `$finish` at the end. Never
  make a test pass by weakening it.
- Fix the cause the message names, not the message. `warning [latch]` builds, as Vivado does, but
  usually means a missing `else` or default.
- Memories become distributed RAM; timing is nextpnr's estimate at the XDC clock (100 MHz on the
  board). `flash` writes SRAM, so the design is gone after a power cycle.
- A rebuild follows the files' content (checksums in `<top>*.deps`), not timestamps; `dewfpga clean` forces all.
- After every change run `dewfpga run <file> --build-only`, or `dewfpga sim` and `dewfpga bit` in a
  folder with a testbench; stop when they exit 0.
