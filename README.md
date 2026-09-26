# dewfpga

Write SystemVerilog on an Apple Silicon Mac and flash a Digilent **Basys3**. No Vivado,
no virtual machine, no Rosetta. `.sv` → `.bit` → board in under five seconds.

[Türkçe](README.tr.md)

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash   # ~4 min, 1.4 GB, once
```

Then in any folder with `blink.sv` + `blink.xdc`:

```bash
dewfpga sim      # iverilog
dewfpga bit      # .sv -> .bit   (4.6 s)
dewfpga flash    # program the board: the LED blinks
```

`dewfpga bit` prints three lines and keeps the full place-and-route log in `<top>.log`:

```
xdc ok: 33 ports, all mapped.
pnr ok: 73 LUT, 27 FF, 278.71 MHz (PASS at 100.00 MHz)   (full log: blink.log)
blink.bit  2.2 MB
```

No Makefile, no project layout. Every `.sv`/`.v` in the folder that holds a module is
synthesized (submodules can live in their own files, named anything; a file that holds no module,
such as a package, an interface or typedefs at file scope, is left out, for now). The top is the module nothing else instantiates,
as in Vivado; if two qualify, name it: `dewfpga flash <top>` (for now the CLI takes one named like the `.xdc` or
like its own file without asking). A module without ports or with `$finish` or
`$stop` is the testbench for `sim`, so for now a design module that calls either is taken for
one too: keep `$finish` and `$stop` in the testbench. Example: `dewfpga new blink`.

## Install

One line, no Node needed:

```bash
curl -fsSL https://nosey-dewdrop.github.io/dewfpga/install | bash
```

It puts the CLI in `~/.dewfpga` (sha256 compared with `dewfpga.tgz.sha256`, an integrity check, not a signature), links `dewfpga` into
Homebrew's bin and runs `dewfpga install`. Re-run the same line to update; `dewfpga uninstall`
removes what the installer built in `~/fpga` (nextpnr-xilinx, prjxray, chipdb, venv, the log),
`~/.dewfpga` and the link, and leaves anything else in `~/fpga`. Requirements: macOS on Apple Silicon,
Xcode Command Line Tools, Homebrew. Switching to the npm package later: remove
`$(brew --prefix)/bin/dewfpga` first, npm wants that path.

## What it installs

| Stage | Tool | From |
|---|---|---|
| simulation | iverilog | brew |
| synthesis | yosys | brew |
| place & route | nextpnr-xilinx | source, pinned commit |
| fasm → frames | prjxray `fasm2frames` | source, pinned commit, venv |
| frames → .bit | prjxray `xc7frames2bit` | source |
| chipdb XC7A35T | `bbaexport` + `bbasm` | generated (~90 MB) |
| programming | openFPGALoader | brew |

Vivado does five jobs in one window; five open-source tools do them here and `install.sh`
wires them together.

## Why a script?

Setting this chain up by hand took six hours. Six walls, none documented in one place:

1. **oss-cad-suite has no nextpnr-xilinx.** You download 497 MB to learn it only has
   ice40/ecp5/gowin. It must be built from source.
2. **Apple clang has no `-fopenmp`.** nextpnr needs `-DUSE_OPENMP=OFF`.
3. **PEP 668.** `pip install` into Homebrew Python is refused; a venv is required.
4. **prjxray needs `--recursive`.** Without it yaml-cpp / googletest / abseil are missing and cmake fails.
5. **cmake 4 rejects prjxray.** It needs `-DCMAKE_POLICY_VERSION_MINIMUM=3.5`.
6. **No prebuilt chipdb.** It is generated per device with `bbaexport.py` + `bbasm`.

Re-running the script skips finished steps. Log: `~/fpga/install.log`.

## Commands

```
dewfpga install                     install the toolchain (safe to re-run)
dewfpga check                       is every piece in place
dewfpga sim|bit|flash|clean [top]   work on the .sv files in the current folder
dewfpga new <dir>                   blink example with a VS Code task (⌘⇧B = flash)
dewfpga uninstall                   remove what install built, the CLI and its link (your files and brew packages stay)
dewfpga --version
```

## Scope

- Board: Digilent **Basys3** (XC7A35T-1CPG236C) only. Another 7-series board would need its own
  chipdb (`DEVICE` in `install.sh`), part name (`PART`, `CHIPDB` in the Makefile) and openFPGALoader
  board name; nothing of that is wired up or tested.
- Platform: **macOS arm64**. Intel Mac and Linux are untested and refused by the script.
- The course's XDC files work as-is (`PACKAGE_PIN` + `IOSTANDARD`); pins the design does not use are ignored.
- Memories become distributed RAM (`-nobram`): fine at lab sizes, a VGA framebuffer would not fit. A memory marked
  `(* ram_style = "block" *)` or `(* rom_style = "block" *)` becomes a block RAM, which is not timed.
- `bit` refuses to write a bitstream when timing is not met. Without a `create_clock` in the XDC every clock is
  checked at 100 MHz, a divided one too, which Vivado does not time; a multiplier that Yosys puts in a DSP48E1
  with a register inside is not timed at all (nextpnr-xilinx). `sim` exits 1 when the testbench prints `$error`/`$fatal`.
- `flash` writes SRAM: the design is gone after a power cycle.

## Tests

`test/run.sh` (46 checks: static analysis, golden `.fasm`, determinism, multi-file designs,
every error path, idempotent install). `FULL=1 test/run.sh` adds a clean install into a
temp directory. CI runs the clean install, the suite and the npm package on a fresh
`macos-15` (Apple Silicon) GitHub runner on every push.

Measured 2026-09-19 and 20 on an M2 with 8 GB: clean install 3 min 37 s to 4 min 17 s (three runs),
1.4 GB; second run 2.7 s; `bit` 4.6 s, peak 552 MB RAM; chipdb generation peak 859 MB RAM.
On the board, 19 and 20 September, five designs: the blink template, switches to LEDs, the Lab 2
adder/subtractor, the display counter and the traffic-light FSM, each built with `dewfpga flash`.
With yosys 0.69 the chain built by the script produces byte-identical `.frames` to the hand-built
chain that lit the LED; with another yosys the netlist differs and only the I/O placement is compared.
