# mac-fpga

Write SystemVerilog on an Apple Silicon Mac and flash a Digilent **Basys3**. No Vivado,
no virtual machine, no Rosetta. `.sv` → `.bit` → board in about 4 seconds.

[Türkçe](README.tr.md)

```bash
curl -fsSL https://nosey-dewdrop.github.io/mac-fpga/install | bash   # ~4 min, 1.4 GB, once
```

Then in any folder with `blink.sv` + `blink.xdc`:

```bash
mac-fpga sim      # iverilog
mac-fpga bit      # .sv -> .bit   (~4 s)
mac-fpga flash    # program the board: the LED blinks
```

No Makefile, no project layout. Every `.sv`/`.v` in the folder is synthesized (submodules
can live in their own files). The top module is the `.sv` with a matching `.xdc`; if that
is ambiguous, `mac-fpga flash <top>`. `sim` needs `<top>_tb.sv`. Example: `mac-fpga new blink`.

## Install

One line, no Node needed:

```bash
curl -fsSL https://nosey-dewdrop.github.io/mac-fpga/install | bash
```

It puts the CLI in `~/.mac-fpga`, links `mac-fpga` into Homebrew's bin and runs
`mac-fpga install`. Re-run the same line to update. Requirements: macOS on Apple Silicon,
Xcode Command Line Tools, Homebrew. Switching to the npm package later: remove
`$(brew --prefix)/bin/mac-fpga` first, npm wants that path.

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
mac-fpga install                     install the toolchain (safe to re-run)
mac-fpga check                       is every piece in place
mac-fpga sim|bit|flash|clean [top]   work on the .sv files in the current folder
mac-fpga new <dir>                   example project with Makefile + VS Code task (⌘⇧B = flash)
mac-fpga --version
```

## Scope

- Board: Digilent **Basys3** (XC7A35T-1CPG236C). Other 7-series boards: change `DEVICE`
  in `install.sh` and regenerate the chipdb; untested.
- Platform: **macOS arm64**. Intel Mac and Linux are untested and refused by the script.
- The course's XDC files work as-is (`PACKAGE_PIN` + `IOSTANDARD`).
- `flash` writes SRAM: the design is gone after a power cycle.

## Tests

`test/run.sh` (27 checks: static analysis, golden `.fasm`, determinism, multi-file designs,
every error path, idempotent install). `FULL=1 test/run.sh` adds a clean install into a
temp directory. CI runs the clean install, the suite and the npm package on a fresh
`macos-15` (Apple Silicon) GitHub runner on every push.

Measured 2026-09-19 on an M2 with 8 GB: clean install 3 min 37 s to 4 min 17 s (three runs),
1.4 GB; second run 2.7 s; `bit` 4.6 s, peak 552 MB RAM; chipdb generation peak 859 MB RAM.
The chain built by the script produces byte-identical `.frames` to the hand-built chain
that lit the LED.
