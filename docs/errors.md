# Which error did you get?
title: Errors while setting up Yosys, nextpnr-xilinx and prjxray on macOS, with fixes
description: Every error hit while building the open-source FPGA chain for a Digilent Basys3 on an Apple Silicon Mac: -fopenmp, externally-managed-environment, yaml-cpp not built, CMake policy version, IOSTANDARD, missing separator, and more. Exact error text, cause, fix.

Every wall hit while setting up the chain on a Mac, in the order of the guide, filed under the exact line the terminal printed. Press Cmd F and paste a piece of your error. Two of them, sections 3.1 and 3.4, print no error line; they are the places you get stuck with nothing to search for.

## Your error is not here?

Read the last lines in the terminal, not the first. Most tools print the real reason last. If it is still stuck, send the last ten lines and the section number on [LinkedIn](https://www.linkedin.com/in/damla-su-bilge-278841278/).

<p class="mute small">All of this was hit on an M2 with 8 GB, macOS 15, on 19 September 2026, with the tool versions listed in <a href="/dewfpga/docs/#9-which-versions-were-tested">section 9 of the guide</a>. Newer versions can move the walls.</p>

## oss-cad-suite-no-nextpnr-xilinx
step: 3.1
source: the obvious first try, 497 MB later
title: oss-cad-suite has no nextpnr-xilinx
summary: YosysHQ's bundle ships nextpnr for ice40, ecp5, nexus and Gowin. Not Xilinx.
date: 2026-09-19

You want Yosys and nextpnr on a Mac. [oss-cad-suite](https://github.com/YosysHQ/oss-cad-suite-build) is YosysHQ's ready-made bundle with a macOS build, so it looks like the whole answer. You download it, unpack it, and there is no `nextpnr-xilinx` inside.

## Why does it happen?

The bundle ships nextpnr for the architectures that live in the main nextpnr repository: ice40, ecp5, nexus and Gowin. Xilinx support lives in a separate project, [openXC7/nextpnr-xilinx](https://github.com/openXC7/nextpnr-xilinx), and it is not part of the bundle. For the Basys3's Artix-7 you need that one, and Homebrew has no formula for it either.

## What is the fix?

Take Yosys, Icarus Verilog and openFPGALoader from Homebrew, and build nextpnr-xilinx from source.

```copy
brew install yosys openfpgaloader icarus-verilog cmake ninja eigen pkg-config python@3.14
```

```copy
cd ~/fpga
git clone --recursive https://github.com/openXC7/nextpnr-xilinx.git
cd nextpnr-xilinx
git checkout 3fd78784c7788f93f276358edf5477221cc6c179
git submodule update --init --recursive
cmake -B build -G Ninja -DARCH=xilinx -DCMAKE_BUILD_TYPE=Release \
  -DUSE_OPENMP=OFF -DBUILD_GUI=OFF -DBUILD_PYTHON=OFF -DBUILD_TESTS=OFF
ninja -C build -j3 nextpnr-xilinx bbasm
```

The build takes about a minute and a half on an M2. Two flags in there each remove a wall of their own: [-DUSE_OPENMP=OFF](/dewfpga/errors/fopenmp/) and `--recursive`, which brings the raw chip data for [the chip database](/dewfpga/errors/no-chipdb/).

Sections 3.1 and 3.3 of the guide: [Homebrew packages](/dewfpga/docs/#31-homebrew-packages) and [nextpnr-xilinx](/dewfpga/docs/#33-nextpnr-xilinx).

## externally-managed-environment
step: 3.2
source: pip, with Homebrew's Python on macOS
title: error: externally-managed-environment
summary: PEP 668. Homebrew's Python refuses a plain pip install. The chain needs a venv.
date: 2026-09-19

You ran `pip install fasm` (or `pip install -e .` inside prjxray) with Homebrew's Python and pip refused with a long message that starts with this line and mentions PEP 668.

## Why does it happen?

Homebrew marks its Python as externally managed, which means pip is not allowed to install into it and break packages that Homebrew itself relies on. Two steps of the FPGA chain are Python scripts (`bbaexport.py` for the chip database and `fasm2frames` for the bitstream) and they need a handful of packages.

## What is the fix?

Make a venv, a private Python where you are free to install things, and use it for every Python command in the chain. The guide keeps it next to everything else in `~/fpga`.

```copy
mkdir -p ~/fpga
"$(brew --prefix)/opt/python@3.14/bin/python3.14" -m venv ~/fpga/venv
~/fpga/venv/bin/pip install fasm==0.0.2.post88 pyyaml==6.0.3 textx==4.4.0 simplejson==4.1.2 intervaltree==3.2.1 numpy==2.5.3 pyjson5==2.0.1
```

Later, prjxray is installed into the same venv with `~/fpga/venv/bin/pip install --no-deps -e .`, and the Makefile calls `~/fpga/venv/bin/python` instead of `python3`.

Do not use `--break-system-packages`. It does what it says.

Section 3.2 of the guide: [Python venv](/dewfpga/docs/#32-python-venv).

## fopenmp
step: 3.3
source: nextpnr-xilinx, while compiling on macOS
title: clang++: error: unsupported option '-fopenmp'
summary: nextpnr's default build asks Apple's clang for OpenMP, which it does not have.
date: 2026-09-19

You ran `ninja` (or `make`) to build [nextpnr-xilinx](https://github.com/openXC7/nextpnr-xilinx) on a Mac and the first file died with this line.

## Why does it happen?

nextpnr's build turns OpenMP on by default. Apple's compiler ships without OpenMP support, so the flag `-fopenmp` is rejected. Homebrew's `libomp` does not change that on its own.

## What is the fix?

Configure with `-DUSE_OPENMP=OFF`. This is the full command used in the guide, from inside the cloned folder.

```copy
cmake -B build -G Ninja \
  -DARCH=xilinx \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_OPENMP=OFF \
  -DBUILD_GUI=OFF -DBUILD_PYTHON=OFF -DBUILD_TESTS=OFF
ninja -C build -j3
```

OpenMP only parallelizes part of the placer; the blink build in the guide takes 4.6 s without it. `-j3` keeps an 8 GB Mac from swapping; with 16 GB or more you can raise it.

## What should you see?

```
~/fpga/nextpnr-xilinx/build/nextpnr-xilinx --version
# "nextpnr-xilinx" -- Next Generation Place and Route (Version 0.9.6)
```

Section 3.3 of the guide walks through the whole build: [nextpnr-xilinx](/dewfpga/docs/#33-nextpnr-xilinx).

## no-chipdb
step: 3.4
source: nextpnr-xilinx, the first time you run it
title: nextpnr-xilinx: where is the chip database for the XC7A35T?
summary: There is no prebuilt chipdb. It is generated per device from the prjxray data.
date: 2026-09-19

nextpnr-xilinx built fine, and now it wants `--chipdb` pointing at a `.bin` file that does not exist anywhere on your disk or in the download.

## Why does it happen?

nextpnr knows how to place and route, but it knows nothing about a specific chip. The description of every part and every wire on the XC7A35T is generated from prjxray's database, and no prebuilt copy is shipped. You generate it once per device.

## What is the fix?

The raw data came along with the `--recursive` clone of nextpnr-xilinx, so nothing extra is downloaded. The Python is the venv from [the PEP 668 wall](/dewfpga/errors/externally-managed-environment/).

```copy
mkdir -p ~/fpga/chipdb
cd ~/fpga/nextpnr-xilinx
~/fpga/venv/bin/python xilinx/python/bbaexport.py \
  --xray xilinx/external/prjxray-db/artix7 \
  --metadata xilinx/external/nextpnr-xilinx-meta/artix7 \
  --device xc7a35tcpg236-1 \
  --constids xilinx/constids.inc \
  --bba ~/fpga/chipdb/xc7a35t.bba
build/bbasm -l ~/fpga/chipdb/xc7a35t.bba ~/fpga/chipdb/xc7a35t.bin
```

The first command takes about 35 seconds and writes a 256 MB text file. The second takes 3 seconds and packs it into the 89 MB binary that nextpnr reads. Peak memory during generation was 859 MB. For a different 7-series board, change `--device` to that board's chip name; `openFPGALoader --list-boards` prints it.

Section 3.4 of the guide: [Chip database](/dewfpga/docs/#34-chip-database).

## yaml-cpp-not-built
step: 3.5
source: CMake, while configuring prjxray
title: Cannot specify include directories for target "yaml-cpp" which is not built by this project
summary: prjxray was cloned without --recursive, so its submodules are empty.
date: 2026-09-19

You ran `cmake -B build` inside [prjxray](https://github.com/f4pga/prjxray) and CMake stopped with this error. If you fix yaml-cpp by hand, the next run fails on googletest, then on abseil.

## Why does it happen?

prjxray pulls six smaller projects in as git submodules. A plain `git clone` leaves those folders empty, and CMake reports them one at a time. Nothing gives you the full list up front.

## What is the fix?

Clone with `--recursive`.

```copy
cd ~/fpga
git clone --recursive https://github.com/f4pga/prjxray.git
cd prjxray
git checkout c9f02d8576042325425824647ab5555b1bc77833
git submodule update --init --recursive
```

If you already have a clone, fill in the submodules instead of cloning again.

```copy
git submodule update --init --recursive
```

Then configure again. On a current CMake you also need the policy flag, which is [the next wall](/dewfpga/errors/cmake-policy-version-minimum/).

```copy
cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DPRJXRAY_BUILD_TESTING=OFF
cmake --build build --target xc7frames2bit -j3
```

The same flag matters for nextpnr-xilinx: its `--recursive` clone is what brings the raw chip data that the chip database is generated from.

Section 3.5 of the guide: [prjxray](/dewfpga/docs/#35-prjxray).

## cmake-policy-version-minimum
step: 3.5
source: CMake 4, while configuring prjxray
title: Compatibility with CMake < 3.5 has been removed from CMake
summary: prjxray is written for an older CMake. CMake 4 refuses it without a policy flag.
date: 2026-09-19

You ran `cmake -B build` inside prjxray with a current Homebrew CMake (version 4 or later) and it stopped at `cmake_minimum_required` with this message.

## Why does it happen?

CMake 4 dropped compatibility with projects that declare a minimum version below 3.5. prjxray still declares one, and the version it asks for is older than what CMake 4 will accept.

## What is the fix?

Tell CMake to treat the project as if it asked for 3.5.

```copy
cmake -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5
cmake --build build --target xc7frames2bit -j3
```

Only the `xc7frames2bit` target is needed. prjxray's own README starts by telling you to install Vivado 2017.2; ignore that, it is for people who map a chip from zero, and the Artix-7 is already mapped.

## What should you see?

```
ls ~/fpga/prjxray/build/tools/xc7frames2bit
```

If it prints the path back, the tool is built.

<p class="mute small">The message above is CMake 4's wording. The guide was written against the same CMake and describes the failure without quoting it: <a href="/dewfpga/docs/#35-prjxray">section 3.5</a>.</p>

## missing-separator
step: 4
source: make, on a Makefile copied from a PDF or a web page
title: Makefile:29: *** missing separator.  Stop.
summary: The recipe lines lost their Tab characters when you copied them.
date: 2026-09-19

You created the Makefile by copying it from the PDF guide or a web page, ran `make`, and it stopped immediately with this message. The line number varies.

## Why does it happen?

Every indented line in a Makefile has to start with a real Tab character. A PDF cannot hold tabs, and some web pages turn them into spaces when you copy. `make` sees spaces, does not recognize the line as a recipe, and gives up.

## What is the fix?

Skip the copying. The five project files are downloadable as they are, tabs included.

- [Makefile](/dewfpga/templates/Makefile)
- [check_xdc.py](/dewfpga/templates/check_xdc.py)
- [blink.sv](/dewfpga/templates/blink.sv) · [blink_tb.sv](/dewfpga/templates/blink_tb.sv) · [blink.xdc](/dewfpga/templates/blink.xdc)

Already edited your copy and want to keep it? This puts the tabs back. Run it once inside your project folder.

```copy
perl -pi -e 's/^ +/\t/' Makefile
```

[Section 4 of the guide](/dewfpga/docs/#4-what-is-in-the-project-folder) has the same files with a paragraph on each.

## no-iostandard-property
step: 5
source: dewfpga bit, the XDC check before place and route (nextpnr alone prints the raw form below)
title: blink.xdc:42: ERROR [no-iostandard-property]: led[15] has a PACKAGE_PIN but no IOSTANDARD in the XDC: every pin needs both, and nextpnr stops without one. Fix: add the line  set_property IOSTANDARD LVCMOS33 [get_ports {led[15]}]
summary: A port in your design has no pin in the .xdc file. nextpnr names the wrong port.
date: 2026-09-19

With the CLI the XDC check names the line before nextpnr runs:

```
blink.xdc:42: ERROR [no-iostandard-property]: led[15] has a PACKAGE_PIN but no IOSTANDARD in the XDC: every pin needs both, and nextpnr stops without one. Fix: add the line  set_property IOSTANDARD LVCMOS33 [get_ports {led[15]}] https://nosey-dewdrop.github.io/dewfpga/errors/no-iostandard-property/
```

nextpnr alone, without the check, prints the lines below.

`make bit` got past synthesis and nextpnr stopped with this line. The port it names looks fine in your pin file.

## Why does it happen?

Some port of your top module has no line in the `.xdc`, either because the line is still commented out with `#` or because of a typo in the name. nextpnr notices, but the port it reports is not the broken one. In the guide's test, misspelling `led` as `ledd` in the pin file produced exactly the message above, which points at a port that was correct.

## What is the fix?

Run the pin check before nextpnr. `check_xdc.py` compares the ports of your synthesized design with the `.xdc` and names the real mistake.

```
ERROR: these ports have NO pin in the XDC (blink):
   - led[15]
   -> the port names in the module must match the names in the XDC (the course file uses
      clk, sw, led, btnC btnU btnL btnR btnD, seg, dp, an). Rename the port in the module,
      or change the name inside [get_ports ...] on that line of the XDC.
      A line that still starts with # is commented out and does not count.
```

Then open the `.xdc` and remove the `#` from every line your design uses, or fix the name inside `[get_ports ...]`. For the blink example that is the two `clk` lines, sixteen `sw` lines and sixteen `led` lines: 33 pin lines plus the `create_clock` line. Digilent's pin file calls the ports `clk`, `sw[0]`, `led[0]`, `seg[0]`, `an[0]`, `btnC` and so on; your module has to use the same names.

The checker is one of the five project files and the guide's Makefile runs it automatically: [check_xdc.py](/dewfpga/templates/check_xdc.py), [section 4](/dewfpga/docs/#4-what-is-in-the-project-folder).

## port-neither-input-nor-output
step: 7
source: dewfpga bit, the source scan before the tools run (Yosys alone prints the raw form below)
title: design.sv:3: note [port-neither-input-nor-output]: wrote the port direction in:  output logic dp,   (the standard and Yosys need it; Vivado accepts both)
summary: The course's seven-segment module has a broken port line. Vivado accepts it, Yosys does not.
date: 2026-09-19

Since #4 the CLI writes the direction into your file and prints a note; the build goes on:

```
design.sv:3: note [port-neither-input-nor-output]: wrote the port direction in:  output logic dp,   (the standard and Yosys need it; Vivado accepts both) https://nosey-dewdrop.github.io/dewfpga/errors/port-neither-input-nor-output/
```

Yosys alone, without the CLI, stops with the lines below.

The first lab that uses the seven-segment display stops in synthesis with this line. Simulation was fine.

## Why does it happen?

The `SevSeg_4digit.sv` module that the course hands out declares its ports like this.

```
output [6:0]seg, logic dp,     // dp takes output from seg, per the standard
```

The standard reads it as `output logic dp`: a port without a direction takes the one before it. Vivado accepts the line, and so does Icarus Verilog, which is why `make sim` passes. Yosys does not implement that inheritance and stops.

## What is the fix?

```copy
output [6:0] seg,
output logic dp,
```

After the change the module synthesizes to 46 cells and the rest of the lab goes through unchanged.

`dewfpga bit` makes this change for you and prints a note, unless a comment sits between `seg,` and `logic dp`, or a comment in the port list holds a `;`; then move that comment out. The course's ready modules in netlist form are the other course files that break ([section 7.1](/dewfpga/docs/#71-which-course-file-breaks)). This one is also the clearest example of a bigger point: two tools read your code, Icarus for simulation and Yosys for synthesis, and they do not agree on everything. Code that passes `make sim` can still fail in `make bit`. [Section 7](/dewfpga/docs/#7-which-errors-does-the-cli-stop-with-and-what-do-they-mean) and [section 8](/dewfpga/docs/#8-what-can-it-not-do) of the guide.

## board-not-found
step: flash
source: openFPGALoader, when you program the board
title: ERROR [board-not-found]: board not found: the Mac sees no Basys3 on USB (openFPGALoader: unable to open ftdi device). Fix: plug the USB into the PROG port, switch the power ON, and try another cable or port.
summary: The Mac does not see the Basys3 on the USB bus: power switch, PROG port, a charge-only cable, the adapter, or the JP2 jumper.
description: openFPGALoader prints 'unable to open ftdi device: -3 (device not found)' and dewfpga flash stops. The five things to check on a Basys3 plugged into an Apple Silicon Mac.
og-title: ERROR: board not found (dewfpga flash, openFPGALoader)
date: 2026-09-20

The build went through, then `dewfpga flash` (or `make flash`) stops with these lines. The bitstream is fine; the Mac cannot see the board.

```
unable to open ftdi device: -3 (device not found)
JTAG init failed with: unable to open ftdi device
ERROR [board-not-found]: board not found: the Mac sees no Basys3 on USB (openFPGALoader: unable to open ftdi device). Fix: plug the USB into the PROG port, switch the power ON, and try another cable or port. https://nosey-dewdrop.github.io/dewfpga/errors/board-not-found/
```

## Why does it happen?

openFPGALoader talks to the FTDI chip on the Basys3 over USB. `device not found` means no such USB device is on the bus at that moment. Nothing on the software side is missing; it is always the cable, the port, the power or the jumper.

## What is the fix?

Check these in order; each one has produced exactly this error.

1. **The power switch.** It is next to the PROG port, top left of the board. It has to be ON; the red power LED lights.
2. **The PROG port, not the USB host port.** The micro-USB socket next to the power switch. The full-size USB-A socket on the board is for a keyboard or a mouse, and programming through it does nothing.
3. **The cable carries data.** Some micro-USB cables are charge-only. If the power LED lights but the Mac still sees nothing, try another cable.
4. **The adapter or hub.** Apple Silicon MacBooks have USB-C only, so the cable goes through a USB-C to USB-A adapter or a hub. Plug the adapter directly into the Mac; a hub that is itself unpowered can drop the board.
5. **The JP2 jumper.** It selects where the board takes power from and has to sit on `USB`. On a board that has been used with an external supply it may sit on `EXT`.

To see whether the Mac has the board at all, before blaming the tools:

```copy
system_profiler SPUSBDataType | grep -A 4 -i "digilent\|ftdi\|basys"
```

Nothing printed means the board is not on the USB bus: cable, port, power, jumper. Something printed and `flash` still fails: unplug the cable, wait two seconds, plug it back in, run `dewfpga flash` again. No driver has to be installed on macOS for this to work.

The design lives in the FPGA's SRAM, so after a power cycle the board is blank again and you flash once more; that is normal, not this error.

Section 2 of the guide: [How do you install it in one line?](/dewfpga/docs/#2-how-do-you-install-it-in-one-line)

## unknown-command
step: check
source: dewfpga, before anything runs
title: ERROR [unknown-command]: unknown command: nope. Fix: one of the commands below.
summary: The word after dewfpga is not one of its commands (install, check, new, sim, bit, flash, clean, uninstall).
date: 2026-09-27

You typed `dewfpga nope` (a typo, or a make target such as `dewfpga synth`). The CLI prints the line and the help below it.

```
ERROR [unknown-command]: unknown command: nope. Fix: one of the commands below. https://nosey-dewdrop.github.io/dewfpga/errors/unknown-command/
dewfpga: Basys3 on macOS without Vivado.
  dewfpga install                 install the toolchain into ~/fpga (safe to re-run)
```

## Why does it happen?

The CLI has eight commands and takes nothing else; a make target (`synth`, `pnr`) is not one of them, the CLI runs those stages itself inside `bit`.

## What is the fix?

Pick the command from the list: `sim` simulates, `bit` builds the bitstream, `flash` programs the board.

```copy
dewfpga --help
```

## unknown-option
step: check
source: dewfpga bit / sim / flash / install, before anything runs
title: ERROR [unknown-option]: unknown option: --x; dewfpga bit takes a module or a file name, nothing else. Fix: dewfpga bit [top]  (dewfpga --help lists the commands).
summary: A word starting with - after the command, or an argument after install: the commands take a module or file name at most, install takes nothing.
date: 2026-09-27

You typed `dewfpga bit --x`, or `dewfpga install something`.

```
ERROR [unknown-option]: unknown option: --x; dewfpga bit takes a module or a file name, nothing else. Fix: dewfpga bit [top]  (dewfpga --help lists the commands). https://nosey-dewdrop.github.io/dewfpga/errors/unknown-option/
ERROR [unknown-option]: dewfpga install takes no arguments. Fix: dewfpga install  (FPGA_HOME=/elsewhere dewfpga install to relocate). https://nosey-dewdrop.github.io/dewfpga/errors/unknown-option/
```

## Why does it happen?

`sim`, `bit`, `flash` and `clean` take one optional argument, the top module (`dewfpga bit counter`) or its file (`dewfpga bit counter.sv`); there are no flags. `install` takes none; where the tools go is set with the environment variable `FPGA_HOME`.

## What is the fix?

Drop the option. A longer simulation timeout is an environment variable too:

```copy
SIM_TIMEOUT=600 dewfpga sim
```

## no-source-file
step: bit
source: dewfpga sim / bit, before anything runs
title: ERROR [no-source-file]: no .sv or .v file in /Users/you/lab4. Fix: cd into the folder with your design, or start one:  dewfpga new blink
summary: The current folder holds no .sv or .v file; dewfpga works on the files in the folder you run it in.
date: 2026-09-27

You ran `dewfpga bit` in a folder without a design (your home folder, or the folder above the lab).

```
ERROR [no-source-file]: no .sv or .v file in /Users/you/lab4. Fix: cd into the folder with your design, or start one:  dewfpga new blink https://nosey-dewdrop.github.io/dewfpga/errors/no-source-file/
```

## Why does it happen?

The CLI reads every `.sv` and `.v` file of the current folder and nothing else; no project file points elsewhere.

## What is the fix?

```copy
cd lab4 && dewfpga bit
```

Or start a fresh design: `dewfpga new blink` makes a folder with a design, a testbench and a pin file.

## run-inside-the-folder
step: bit
source: dewfpga sim / bit, before anything runs
title: ERROR [run-inside-the-folder]: w/blink is a path, and dewfpga works on the .sv files in the current folder. Fix: run it inside the folder that holds the .sv files:  cd "w" && dewfpga bit blink
summary: The argument holds a slash: the CLI takes a module or a file name in the current folder, not a path.
date: 2026-09-27

You ran `dewfpga bit lab4/counter.sv` from the folder above.

```
ERROR [run-inside-the-folder]: w/blink is a path, and dewfpga works on the .sv files in the current folder. Fix: run it inside the folder that holds the .sv files:  cd "w" && dewfpga bit blink https://nosey-dewdrop.github.io/dewfpga/errors/run-inside-the-folder/
```

## Why does it happen?

Every file of the design has to be in one folder, next to the pin file, and the build products go there too. A path would leave the other files behind.

## What is the fix?

The line names it:

```copy
cd lab4 && dewfpga bit counter
```

## file-name-with-space
step: bit
source: dewfpga sim / bit, before anything runs
title: ERROR [file-name-with-space]: 'my blink.sv': file names with spaces are not supported by the tools. Fix: rename it (e.g. my_blink.sv).
summary: A .sv, .v or .xdc file name with a space in it; yosys, iverilog and nextpnr take file lists split at spaces.
date: 2026-09-27

```
ERROR [file-name-with-space]: 'my blink.sv': file names with spaces are not supported by the tools. Fix: rename it (e.g. my_blink.sv). https://nosey-dewdrop.github.io/dewfpga/errors/file-name-with-space/
```

## Why does it happen?

The tools are given the file names on one command line, split at spaces; `my blink.sv` would arrive as two files that do not exist.

## What is the fix?

```copy
mv "my blink.sv" my_blink.sv
```

## path-with-space
step: check
source: dewfpga, before anything runs
title: ERROR [path-with-space]: a path with a space (/Users/you/My Projects/dewfpga / /Users/you/fpga): the FPGA tools cannot handle that. Fix: move the folder to a path without spaces, or set FPGA_HOME to one.
summary: The CLI's own folder or FPGA_HOME has a space in its path; the build scripts hand those paths to make and the tools unquoted.
date: 2026-09-27

The line prints the two paths it checked: where the CLI is, and where the tools are.

```
ERROR [path-with-space]: a path with a space (/Users/you/My Projects/dewfpga / /Users/you/fpga): the FPGA tools cannot handle that. Fix: move the folder to a path without spaces, or set FPGA_HOME to one. https://nosey-dewdrop.github.io/dewfpga/errors/path-with-space/
```

## Why does it happen?

make and the tools split their arguments at spaces; a path with one is two paths to them.

## What is the fix?

Move the clone (`~/.dewfpga` is where install.sh puts it), or point `FPGA_HOME` at a folder without spaces:

```copy
FPGA_HOME=~/fpga dewfpga install
```

## utf8-bom
step: bit
source: dewfpga sim / bit, before anything runs
title: blink.sv:1: ERROR [utf8-bom]: blink.sv starts with a byte-order mark (saved as 'UTF-8 with BOM'), and yosys stops at its first token. Fix: save it as plain UTF-8, or remove it:  LC_ALL=C sed -i '' $'1s/^\xEF\xBB\xBF//' blink.sv
summary: The file starts with the three invisible bytes EF BB BF that Notepad and some editors write; yosys reads them as a token it does not know.
date: 2026-09-27

```
blink.sv:1: ERROR [utf8-bom]: blink.sv starts with a byte-order mark (saved as 'UTF-8 with BOM'), and yosys stops at its first token. Fix: save it as plain UTF-8, or remove it:  LC_ALL=C sed -i '' $'1s/^\xEF\xBB\xBF//' blink.sv https://nosey-dewdrop.github.io/dewfpga/errors/utf8-bom/
```

## Why does it happen?

Windows Notepad's "UTF-8 with BOM" and some Word exports put a byte-order mark before the first character. Vivado skips it; yosys does not, and would stop with `syntax error, unexpected TOK_ID` at line 1, so the CLI names the real cause first.

## What is the fix?

Save the file as plain UTF-8 (VS Code: the encoding in the status bar), or strip the bytes:

```copy
LC_ALL=C sed -i '' $'1s/^\xEF\xBB\xBF//' blink.sv
```

## folder-exists
step: check
source: dewfpga new
title: ERROR [folder-exists]: w already exists, and dewfpga new does not overwrite. Fix: pick another name, or cd w and work there.
summary: The folder dewfpga new was told to create is already there; it never overwrites a design.
date: 2026-09-27

```
ERROR [folder-exists]: w already exists, and dewfpga new does not overwrite. Fix: pick another name, or cd w and work there. https://nosey-dewdrop.github.io/dewfpga/errors/folder-exists/
```

## Why does it happen?

`dewfpga new blink` copies a template design into a new folder `blink`; a folder of that name may hold your work, so the CLI stops rather than write into it.

## What is the fix?

```copy
dewfpga new blink2
```

## no-xdc-file
step: bit
source: dewfpga bit / flash, before synthesis
title: ERROR [no-xdc-file]: no .xdc pin file in this folder, so nothing says which pin each port is on. Fix: copy ~/.dewfpga/templates/Basys3_Master.xdc here and uncomment the pins you use.
summary: The folder has the design but no .xdc; the pin file says which pin of the Basys3 each port goes to, and without it nothing can be placed.
date: 2026-09-27

`dewfpga sim` works without it; `dewfpga bit` stops here, before synthesis. The line prints the full path of the template.

```
ERROR [no-xdc-file]: no .xdc pin file in this folder, so nothing says which pin each port is on. Fix: copy /Users/you/.dewfpga/templates/Basys3_Master.xdc here and uncomment the pins you use. https://nosey-dewdrop.github.io/dewfpga/errors/no-xdc-file/
```

## Why does it happen?

The XDC is the one file Vivado projects keep outside the sources, so a lab folder copied without it has the design and nothing that binds `led[0]` to pin U16.

## What is the fix?

Copy the course's master file next to the design and remove the `#` in front of the pins the design uses; the CLI takes `<top>.xdc`, or the only `.xdc` in the folder:

```copy
cp ~/.dewfpga/templates/Basys3_Master.xdc . && dewfpga bit
```

## two-xdc-files
step: bit
source: dewfpga bit / flash, before synthesis
title: ERROR [two-xdc-files]: 2 .xdc files here (a.xdc b.xdc) and none is named blink.xdc, so nothing says which one holds the pins. Fix: keep one, or name it blink.xdc.
summary: Several .xdc files in the folder and none named after the top module; the CLI does not guess which one is the pin file.
date: 2026-09-27

```
ERROR [two-xdc-files]: 2 .xdc files here (a.xdc b.xdc) and none is named blink.xdc, so nothing says which one holds the pins. Fix: keep one, or name it blink.xdc. https://nosey-dewdrop.github.io/dewfpga/errors/two-xdc-files/
```

## Why does it happen?

The pin file is `<top>.xdc` when it exists, else the only `.xdc` in the folder. Two files and no name that matches the top: a backup (`Basys3_Master copy.xdc`) or two labs in one folder.

## What is the fix?

```copy
mv Basys3_Master.xdc blink.xdc
```

## no-testbench
step: sim
source: dewfpga sim, before iverilog
title: ERROR [no-testbench]: no testbench for blink in this folder: a testbench is a module without ports that instantiates blink and ends with $finish; blink_tb.sv is the usual name. Fix: write one next to the design; 'dewfpga new blink' gives an example (blink/blink_tb.sv).
summary: No module without ports instantiates the top module, so there is nothing to simulate it with.
date: 2026-09-27

```
ERROR [no-testbench]: no testbench for blink in this folder: a testbench is a module without ports that instantiates blink and ends with $finish; blink_tb.sv is the usual name. Fix: write one next to the design; 'dewfpga new blink' gives an example (blink/blink_tb.sv). https://nosey-dewdrop.github.io/dewfpga/errors/no-testbench/
```

## Why does it happen?

The CLI finds the testbench by its content, not its name: a module with no ports that instantiates the design. A testbench with ports, or one for another module, is not it.

## What is the fix?

Write `blink_tb.sv` next to the design: a module with no ports, an instance of `blink`, a clock, checks with `$error`, and `$finish` at the end. `dewfpga new blink` gives one to copy from.

```copy
dewfpga new example && cat example/blink_tb.sv
```

## no-top-module
step: bit
source: dewfpga sim / bit, before anything runs
title: ERROR [no-top-module]: could not find a top module in blink.sv blink_tb.sv. Fix: name it:  dewfpga bit <module>
summary: The source scan ended without a top module and without a reason; naming the module on the command line settles it.
date: 2026-09-27

```
ERROR [no-top-module]: could not find a top module in blink.sv blink_tb.sv. Fix: name it:  dewfpga bit <module> https://nosey-dewdrop.github.io/dewfpga/errors/no-top-module/
```

## Why does it happen?

The scan of the sources normally names the top (the one module nothing instantiates) or prints why it cannot ([two-tops](/dewfpga/errors/two-tops/), [no-design-module](/dewfpga/errors/no-design-module/)). This line is the fallback when it printed neither.

## What is the fix?

```copy
dewfpga bit counter
```

## toolchain-not-installed
step: check
source: dewfpga check, or dewfpga bit / flash before synthesis
title: ERROR [toolchain-not-installed]: something is missing (the ✗ rows above), so dewfpga bit and flash cannot run. Fix: dewfpga install  (safe to re-run; it only builds what is missing).
summary: nextpnr-xilinx, the chip database or another tool is not under FPGA_HOME; the build needs all of them.
date: 2026-09-27

`dewfpga check` prints a row per tool and this line when one is missing; `dewfpga bit` prints the second form and stops before synthesis.

```
  ✗ nextpnr-xilinx   MISSING
  ✗ chipdb           MISSING
ERROR [toolchain-not-installed]: something is missing (the ✗ rows above), so dewfpga bit and flash cannot run. Fix: dewfpga install  (safe to re-run; it only builds what is missing). https://nosey-dewdrop.github.io/dewfpga/errors/toolchain-not-installed/
ERROR [toolchain-not-installed]: toolchain not installed: no nextpnr-xilinx or chipdb in /Users/you/fpga. Fix: dewfpga install   (status: dewfpga check). https://nosey-dewdrop.github.io/dewfpga/errors/toolchain-not-installed/
```

## Why does it happen?

The install has not run, was interrupted, or put the tools somewhere else (`FPGA_HOME` set to another folder in that shell).

## What is the fix?

```copy
dewfpga install
```

It builds only what is missing (about 12 minutes from nothing). If you installed elsewhere, set `FPGA_HOME` to that folder.

## yosys-slang-does-not-load
step: check
source: dewfpga check
title: ERROR [yosys-slang-does-not-load]: /Users/you/fpga/yosys-slang/build/slang.so was built for another yosys (brew upgrade yosys leaves it behind), so the SystemVerilog yosys' own reader refuses would not build. Fix: dewfpga install  (it rebuilds the reader, about 4 min).
summary: The second reader is a plugin compiled against one yosys; after brew upgrade yosys it no longer loads.
date: 2026-09-27

`dewfpga check` marks the row ✗ and prints this line.

```
  ✗ yosys-slang      /Users/you/fpga/yosys-slang/build/slang.so does not load in Yosys 0.69
ERROR [yosys-slang-does-not-load]: /Users/you/fpga/yosys-slang/build/slang.so was built for another yosys (brew upgrade yosys leaves it behind), so the SystemVerilog yosys' own reader refuses would not build. Fix: dewfpga install  (it rebuilds the reader, about 4 min). https://nosey-dewdrop.github.io/dewfpga/errors/yosys-slang-does-not-load/
```

## Why does it happen?

yosys-slang is a shared library that links against yosys' own headers and ABI; a new yosys from brew changes them, and the plugin fails to load. Without it, a design that yosys' own reader refuses (interfaces, unpacked arrays, foreach ...) stops with [second-reader-missing](/dewfpga/errors/second-reader-missing/).

## What is the fix?

```copy
dewfpga install
```

## fpga-home-unsafe
step: check
source: dewfpga uninstall
title: ERROR [fpga-home-unsafe]: FPGA_HOME is /Users/you; refusing to delete that. Fix: remove the six entries by hand: nextpnr-xilinx yosys-slang prjxray chipdb venv install.log
summary: FPGA_HOME points at your home folder or /; uninstall deletes what install.sh put under FPGA_HOME and will not touch those.
date: 2026-09-27

```
ERROR [fpga-home-unsafe]: FPGA_HOME is /Users/you; refusing to delete that. Fix: remove the six entries by hand: nextpnr-xilinx yosys-slang prjxray chipdb venv install.log https://nosey-dewdrop.github.io/dewfpga/errors/fpga-home-unsafe/
```

## Why does it happen?

`uninstall` removes six entries under `FPGA_HOME` and then the folder if it is empty. With `FPGA_HOME=$HOME` it would work inside your home folder, so it stops.

## What is the fix?

Point it at the real install folder (the default is `~/fpga`), or remove the six entries yourself:

```copy
FPGA_HOME=~/fpga dewfpga uninstall
```

## no-install-found
step: check
source: dewfpga uninstall
title: note [no-install-found]: nothing to remove: no dewfpga install found in /Users/you/fpga (FPGA_HOME=/elsewhere dewfpga uninstall for one installed elsewhere).
summary: Not an error: uninstall found none of the six entries install.sh writes under FPGA_HOME.
date: 2026-09-27

```
note [no-install-found]: nothing to remove: no dewfpga install found in /Users/you/fpga (FPGA_HOME=/elsewhere dewfpga uninstall for one installed elsewhere). https://nosey-dewdrop.github.io/dewfpga/errors/no-install-found/
```

## Why does it happen?

The tools were never installed, were already removed, or were installed under another `FPGA_HOME`.

## What is the fix?

Nothing, unless you installed elsewhere:

```copy
FPGA_HOME=/path/you/used dewfpga uninstall
```

## two-tops
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: counter.sv:4: ERROR [two-tops]: 2 modules could be the top (nothing instantiates them): counter (counter.sv:4), top (counter.sv:8). Fix: name it:  dewfpga bit counter
summary: Two or more design modules that nothing instantiates; the CLI does not pick one by file name (Lab 4 folders name the file after the wrong one).
date: 2026-09-27

Both `dewfpga sim` and `dewfpga bit` stop before make; each names its own command in the fix.

```
counter.sv:4: ERROR [two-tops]: 2 modules could be the top (nothing instantiates them): counter (counter.sv:4), top (counter.sv:8). Fix: name it:  dewfpga bit counter https://nosey-dewdrop.github.io/dewfpga/errors/two-tops/
```

## Why does it happen?

The top is the one design module nothing instantiates. Two of them (an old version kept in the file, two labs in one folder) and the CLI will not guess; a `.xdc` named after one of them decides it, and the CLI says so (`top module: top (named by top.xdc)`).

## What is the fix?

Name the module, or name the pin file after it:

```copy
dewfpga bit counter
```

## top-is-a-testbench
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: blink_tb.sv:6: ERROR [top-is-a-testbench]: blink_tb is a testbench (it has no ports), not a design. Fix: name a design module instead:  dewfpga bit blink.
summary: The module named on the command line has no ports, so it is a testbench; a bitstream needs a design with ports.
date: 2026-09-27

```
blink_tb.sv:6: ERROR [top-is-a-testbench]: blink_tb is a testbench (it has no ports), not a design. Fix: name a design module instead:  dewfpga bit blink. https://nosey-dewdrop.github.io/dewfpga/errors/top-is-a-testbench/
```

## Why does it happen?

A module without ports has nothing to connect to a pin; the CLI treats it as a testbench for the design it instantiates.

## What is the fix?

```copy
dewfpga bit blink
```

## no-such-module
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: ERROR [no-such-module]: no module named nope in blink.sv blink_tb.sv; the modules here: blink. Fix: name one of them, or the file that holds it:  dewfpga bit blink
summary: The name on the command line is neither a module nor a file of this folder.
date: 2026-09-27

```
ERROR [no-such-module]: no module named nope in blink.sv blink_tb.sv; the modules here: blink. Fix: name one of them, or the file that holds it:  dewfpga bit blink https://nosey-dewdrop.github.io/dewfpga/errors/no-such-module/
```

## Why does it happen?

`dewfpga bit X` takes X as a module name, or as a file name (`X.sv`) whose one design module becomes the top. Neither exists here: a typo, or the wrong folder.

## What is the fix?

The line lists the design modules of the folder; name one:

```copy
dewfpga bit blink
```

## no-design-module
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: ERROR [no-design-module]: no design module in blink_tb.sv (only testbenches). Fix: a design is a module with ports; put it in a .sv file in this folder, or start one:  dewfpga new blink
summary: Every module in the folder has no ports; there is nothing to build.
date: 2026-09-27

```
ERROR [no-design-module]: no design module in blink_tb.sv (only testbenches). Fix: a design is a module with ports; put it in a .sv file in this folder, or start one:  dewfpga new blink https://nosey-dewdrop.github.io/dewfpga/errors/no-design-module/
```

## Why does it happen?

The design's file is missing from the folder (copied the testbench only), or the design was written without ports.

## What is the fix?

Put the design's `.sv` next to the testbench, or give the module its ports (`module blink(input logic clk, output logic [15:0] led);`).

```copy
ls *.sv
```

## module-defined-twice
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: design.sv:1: ERROR [module-defined-twice]: module top is defined twice: design.sv:1 and design_old.sv:2; the last one read would win silently. Fix: keep one, or move the backup out of this folder.
summary: Two files in the folder declare the same module; the tools would take the last one read, so a backup could be built instead of the design.
date: 2026-09-27

```
design.sv:1: ERROR [module-defined-twice]: module top is defined twice: design.sv:1 and design_old.sv:2; the last one read would win silently. Fix: keep one, or move the backup out of this folder. https://nosey-dewdrop.github.io/dewfpga/errors/module-defined-twice/
```

## Why does it happen?

A backup (`design_old.sv`, `design copy.sv`) kept next to the design. Vivado projects list their sources, so a stray file does nothing there; the CLI reads every file of the folder.

## What is the fix?

```copy
mkdir -p old && mv design_old.sv old/
```

## finish-in-design
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: design.sv:6: ERROR [finish-in-design]: $finish in a design module (top): Vivado ignores it (UG901 Table 21: $finish Ignored) and yosys stops on it. Fix: remove it, move the check to the testbench, or wrap it in `ifndef SYNTHESIS ... `endif.
summary: A $finish or $stop inside a module with ports; there is no hardware for it, and yosys stops on it where Vivado drops it.
date: 2026-09-27

```
design.sv:6: ERROR [finish-in-design]: $finish in a design module (top): Vivado ignores it (UG901 Table 21: $finish Ignored) and yosys stops on it. Fix: remove it, move the check to the testbench, or wrap it in `ifndef SYNTHESIS ... `endif. https://nosey-dewdrop.github.io/dewfpga/errors/finish-in-design/
```

## Why does it happen?

`$finish` ends a simulation; a chip does not end. Vivado lists it as ignored in synthesis (UG901 Table 21); yosys refuses it. A check that stops the simulation belongs in the testbench.

## What is the fix?

Move the check to the testbench, or hide it from synthesis (yosys and Vivado both define `SYNTHESIS`):

```copy
`ifndef SYNTHESIS
  if (done) $finish;
`endif
```

## decl-init-reads-signal
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: design.sv:2: ERROR [decl-init-reads-signal]: `sum = sw[3:0] + sw[7:4]` in a declaration is a start value, not a wire: it reads sw once, at time 0 (IEEE 1800-2017 6.8; yosys makes it the power-up value, so the board never follows sw). Fix: write  assign sum = sw[3:0] + sw[7:4];  and declare sum without the = part.
summary: `logic [3:0] sum = sw[3:0] + sw[7:4];` sets a power-up value from a signal; it is not a continuous assignment, and the board would show the value from time 0 forever.
date: 2026-09-27

```
design.sv:2: ERROR [decl-init-reads-signal]: `sum = sw[3:0] + sw[7:4]` in a declaration is a start value, not a wire: it reads sw once, at time 0 (IEEE 1800-2017 6.8; yosys makes it the power-up value, so the board never follows sw). Fix: write  assign sum = sw[3:0] + sw[7:4];  and declare sum without the = part. https://nosey-dewdrop.github.io/dewfpga/errors/decl-init-reads-signal/
```

## Why does it happen?

`type name = expr;` in a declaration is an initializer: evaluated once when the simulation starts (IEEE 1800-2017 6.8). The simulation looks right when the inputs never change; on the board the register keeps the value it was configured with and never follows the switches.

## What is the fix?

A wire is a continuous assignment; a register is loaded in an always block:

```copy
logic [3:0] sum;
assign sum = sw[3:0] + sw[7:4];
```

## unnamed-instance
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: design.sv:5: note [unnamed-instance]: named the instance:  inv u_inv(sw[0], led[0]);   (the standard and Yosys need it; Vivado accepts both)
summary: `inv(sw[0], led[0]);`, an instance without a name: Vivado accepts it, the standard and yosys do not, so the CLI names it u_inv in your file and says so.
date: 2026-09-27

Not an error: the build goes on. The CLI edited the line in your file and prints it. When it cannot edit (a testbench, a read-only file) it prints the ERROR form and stops.

```
design.sv:5: note [unnamed-instance]: named the instance:  inv u_inv(sw[0], led[0]);   (the standard and Yosys need it; Vivado accepts both) https://nosey-dewdrop.github.io/dewfpga/errors/unnamed-instance/
design.sv:5: ERROR [unnamed-instance]: `inv(` is an instance without a name: Vivado lets that pass; the standard and Yosys do not. Fix: write  inv u_inv( https://nosey-dewdrop.github.io/dewfpga/errors/unnamed-instance/
```

## Why does it happen?

IEEE 1800 requires an instance name between the module name and the port list; Vivado's parser is lenient, so a lab that built in Vivado can carry one.

## What is the fix?

Nothing, when the note printed: the name is in your file now. Otherwise write one yourself:

```copy
inv u_inv(sw[0], led[0]);
```

## vivado-netlist-in-folder
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: leftover_func_synth.v:2: ERROR [vivado-netlist-in-folder]: leftover_func_synth.v is a netlist Vivado wrote after synthesis, not source code (its header says so, and Yosys cannot read it); Vivado writes these under .sim/ and .runs/. Fix: delete it from this folder and keep your own .sv files.
summary: A .v file whose header says it is a Vivado post-synthesis simulation netlist sits next to the sources; it is not a design and yosys cannot read it.
date: 2026-09-27

```
leftover_func_synth.v:2: ERROR [vivado-netlist-in-folder]: leftover_func_synth.v is a netlist Vivado wrote after synthesis, not source code (its header says so, and Yosys cannot read it); Vivado writes these under .sim/ and .runs/. Fix: delete it from this folder and keep your own .sv files. https://nosey-dewdrop.github.io/dewfpga/errors/vivado-netlist-in-folder/
```

## Why does it happen?

Vivado writes `<top>_func_synth.v` (`write_verilog -mode funcsim`, marked `NotValidForBitStream`) under the project's `.sim/` folder; a folder copied whole brings it along, and the CLI reads every `.v` in the folder.

## What is the fix?

```copy
rm *_func_synth.v *_time_synth.v
```

## port-without-pin
step: bit
source: dewfpga bit, the XDC check before place and route
title: blink.xdc:42: ERROR [port-without-pin]: led[15] has no pin in the XDC: the line that names it starts with # (commented out), so it does not count. Fix: remove the # at the start of that line (the same name, the index the design uses: led[15]).
summary: A port of the top module has no PACKAGE_PIN line in the XDC: the line is commented out, the index is missing, the name differs, or the port has a shape this check does not read yet ([0:0], [4:1]).
date: 2026-09-27

One line per port, the first twelve; the file:line is the commented-out XDC line, or the port's declaration when no XDC line names it. Four causes, four texts:

```
blink.xdc:42: ERROR [port-without-pin]: led[15] has no pin in the XDC: the line that names it starts with # (commented out), so it does not count. Fix: remove the # at the start of that line (the same name, the index the design uses: led[15]). https://nosey-dewdrop.github.io/dewfpga/errors/port-without-pin/
blink.sv:10: ERROR [port-without-pin]: led[15] has no pin in the XDC: no line names it (the XDC has lines for led with other indices, none for led[15]). Fix: add a line for led[15] to the XDC (copy a led line, change the index and the pin), or make the port narrower. https://nosey-dewdrop.github.io/dewfpga/errors/port-without-pin/
design.sv:2: ERROR [port-without-pin]: led is a vector of one bit (led [0:0]), so its pin in the XDC is named led[0] (the XDC has that line); this check reads a one-bit port as the scalar led, not led[0]: a [0:0] port is not read yet. Fix: declare it as a scalar (led without the range) and name it [get_ports led] in the XDC; a module written for any width cannot, and then this check is what stops you, not Vivado. https://nosey-dewdrop.github.io/dewfpga/errors/port-without-pin/
design.sv:2: ERROR [port-without-pin]: led[0] is not a bit of led: led is declared [4:1] (its bits and its XDC names start at 1), and this check numbers a port's bits from 0: a range that does not start at 0 is not read yet. Fix: declare led [3:0] and use the names from led[0] in the XDC; if the handout numbers from 1, this check is what stops you, not Vivado. https://nosey-dewdrop.github.io/dewfpga/errors/port-without-pin/
```

## Why does it happen?

The course's `Basys3_Master.xdc` ships with every pin commented out; each port of the design needs its line uncommented, with the same name and index. A port named otherwise (`LED`, `leds`) matches nothing. The last two texts are limits of this check, not of the chip: a one-bit vector (`[0:0]`) and a range that does not start at 0 are legal SystemVerilog that nextpnr places, and the check does not read them yet.

## What is the fix?

Uncomment the line, with the name and index the design uses:

```copy
set_property -dict { PACKAGE_PIN L1    IOSTANDARD LVCMOS33 } [get_ports {led[15]}]
```

For the two shapes the check does not read: declare the port as a scalar, or with a range from 0.

## no-such-pin
step: bit
source: dewfpga bit, the XDC check before place and route (nextpnr alone prints the raw line below, with no file:line)
title: blink.xdc:5: ERROR [no-such-pin]: ZZ99 is not an I/O pin of the Basys3's chip (xc7a35tcpg236; a pin is a letter and a number, in capitals: W5, U16, V17), so clk would have no pin and nextpnr would stop here. Fix: write the pin clk is wired to on this line (the course's Basys3_Master.xdc puts clk on W5): copy its line from Basys3_Master.xdc, or take the pin from the board's schematic.
summary: A PACKAGE_PIN in the XDC names a pin the chip does not have: a typo, a pin of another board, a power pin, or a pin written in small letters (w5).
date: 2026-10-04

Two texts: a pin the chip does not have, and a pin written in small letters (nextpnr reads `W5`, not `w5`):

```
blink.xdc:5: ERROR [no-such-pin]: ZZ99 is not an I/O pin of the Basys3's chip (xc7a35tcpg236; a pin is a letter and a number, in capitals: W5, U16, V17), so clk would have no pin and nextpnr would stop here. Fix: write the pin clk is wired to on this line (the course's Basys3_Master.xdc puts clk on W5): copy its line from Basys3_Master.xdc, or take the pin from the board's schematic. https://nosey-dewdrop.github.io/dewfpga/errors/no-such-pin/
blink.xdc:5: ERROR [no-such-pin]: w5 is written in small letters, and the chip's pin names are capitals (W5): nextpnr reads w5 as a pin the chip does not have, so clk would have no pin. Fix: write  PACKAGE_PIN W5  on this line. https://nosey-dewdrop.github.io/dewfpga/errors/no-such-pin/
```

nextpnr alone stopped with this line, with no file and no line number, and the previous `blink.bit` stayed in the folder as if it were the result:

```
ERROR: Unable to constrain IO 'clk', device does not have a pin named 'ZZ99'
```

## Why does it happen?

The chip on the Basys3 (XC7A35T in the CPG236 package) has 236 pins, 106 of them I/O, each named by a letter and a number (`W5`, `U16`, `V17`). The XDC gives each port one of them. A name that is not on the chip, a pin copied from another board's file, a power pin, or `w5` in small letters is a pin nextpnr cannot find. Before this check, nextpnr's line was all there was, and the build that stopped there left yesterday's bitstream next to the sources.

The check reads the chip's pin list from the prjxray database the bitstream itself is built from (`package_pins.csv` of `xc7a35tcpg236-1`), so a pin it accepts is a pin the chain can place.

## What is the fix?

Copy the port's line from the course's `Basys3_Master.xdc`; its pins are the board's wiring:

```copy
set_property -dict { PACKAGE_PIN W5   IOSTANDARD LVCMOS33 } [get_ports clk]
```

For a pin written in small letters, write it in capitals. A failed build leaves no `.bit`, `.fasm` or `.frames` behind, so `dewfpga flash` after it builds again and stops at the same line; it never programs the old design.

## pin-used-twice
step: bit
source: dewfpga bit, the XDC check before place and route (nextpnr alone prints the raw lines below)
title: blink.xdc:27: ERROR [pin-used-twice]: pin U16 is given to 2 ports, clk (blink.xdc:5) and led[0] (blink.xdc:27): one pin takes one port, so nextpnr would stop here. Fix: give each port its own pin: copy their lines from the course's Basys3_Master.xdc (clk is on W5, led[0] is on U16).
summary: Two ports of the design have the same PACKAGE_PIN in the XDC: a copied line whose pin was not changed.
date: 2026-10-04

```
blink.xdc:27: ERROR [pin-used-twice]: pin U16 is given to 2 ports, clk (blink.xdc:5) and led[0] (blink.xdc:27): one pin takes one port, so nextpnr would stop here. Fix: give each port its own pin: copy their lines from the course's Basys3_Master.xdc (clk is on W5, led[0] is on U16). https://nosey-dewdrop.github.io/dewfpga/errors/pin-used-twice/
```

nextpnr alone prints a warning and then stops, naming a site instead of a line:

```
Warning: Conflicting outputs: IO 'led[0]' and IO 'clk' are both constrained to package pin 'U16' (site 'IOB_X0Y3/IOB33/PAD'); only one of them can drive the pad
ERROR: Cell 'clk' cannot be bound to bel 'IOB_X0Y3/IOB33/PAD' since it is already bound to cell 'led[0]'
```

## Why does it happen?

A line in the XDC was copied for a new port and its pin was not changed, so two ports ask for one pad. One pad has one driver.

## What is the fix?

Give each port its own pin, from the course's `Basys3_Master.xdc`:

```copy
set_property -dict { PACKAGE_PIN W5   IOSTANDARD LVCMOS33 } [get_ports clk]
set_property -dict { PACKAGE_PIN U16  IOSTANDARD LVCMOS33 } [get_ports {led[0]}]
```

## xdc-get-ports-form
step: bit
source: dewfpga bit, the XDC check before place and route
title: blink.xdc:43: warning [xdc-get-ports-form]: `get_ports {led[*]}` is a wildcard: Vivado expands it, and this check does not read that form yet, so the ports it names count as unpinned here. Fix: write one line per port with its full name, as the course's Basys3_Master.xdc does:  set_property -dict { PACKAGE_PIN V17  IOSTANDARD LVCMOS33 } [get_ports {sw[0]}]
summary: A get_ports with a wildcard, a list of several ports or an option (-regexp, -filter): Vivado expands those, this check reads one full port name per line.
date: 2026-09-27

A warning: the build goes on. If a port gets its pin only through that form, [port-without-pin](/dewfpga/errors/port-without-pin/) follows.

```
blink.xdc:43: warning [xdc-get-ports-form]: `get_ports {led[*]}` is a wildcard: Vivado expands it, and this check does not read that form yet, so the ports it names count as unpinned here. Fix: write one line per port with its full name, as the course's Basys3_Master.xdc does:  set_property -dict { PACKAGE_PIN V17  IOSTANDARD LVCMOS33 } [get_ports {sw[0]}] https://nosey-dewdrop.github.io/dewfpga/errors/xdc-get-ports-form/
```

## Why does it happen?

The XDC check reads `[get_ports {name}]` and `[get_ports {name[i]}]`, one port per line, the form the course file uses. Wildcards and lists are Tcl that Vivado evaluates; this check does not.

## What is the fix?

```copy
set_property -dict { PACKAGE_PIN U16  IOSTANDARD LVCMOS33 } [get_ports {led[0]}]
```

## xdc-port-case
step: bit
source: dewfpga bit, the XDC check before place and route
title: blink.xdc:43: warning [xdc-port-case]: the XDC names 'LED[3]' but the design's port is spelled led (same name, different case), so this line is an unused pin. Fix: make the two spellings the same.
summary: An XDC line names a port that differs from the design's only in case; names are case-sensitive, so the line pins nothing.
date: 2026-09-27

A warning: the build goes on, that line ignored.

```
blink.xdc:43: warning [xdc-port-case]: the XDC names 'LED[3]' but the design's port is spelled led (same name, different case), so this line is an unused pin. Fix: make the two spellings the same. https://nosey-dewdrop.github.io/dewfpga/errors/xdc-port-case/
```

## Why does it happen?

Unused pins in the XDC are normal (a whole master file with every pin uncommented), so they are ignored without a word; a name that matches a port except for case looks like a typo, so it is named.

## What is the fix?

Rename the port in the module, or the name in `[get_ports ...]`:

```copy
set_property -dict { PACKAGE_PIN V19  IOSTANDARD LVCMOS33 } [get_ports {led[3]}]
```

## iverilog-refused
step: sim
source: dewfpga sim, iverilog
title: design.sv:4: ERROR [iverilog-refused]: iverilog cannot compile this code (its message is above). Fix: fix the first line it names; the errors after the first often follow from it.
summary: iverilog stopped with an error; its own lines are above, and this line names the first of them.
date: 2026-09-27

```
iverilog -g2012 -o top_sim design.sv tb.sv
design.sv:4: error: Unable to bind wire/reg/memory `summ' in `tb.dut'
design.sv:4: error: Unable to elaborate r-value: summ
2 error(s) during elaboration.
design.sv:4: ERROR [iverilog-refused]: iverilog cannot compile this code (its message is above). Fix: fix the first line it names; the errors after the first often follow from it. https://nosey-dewdrop.github.io/dewfpga/errors/iverilog-refused/
```

## Why does it happen?

A syntax error, an undeclared name (`summ` above: a typo of `sum`), or a construct iverilog does not support (`sorry: ...`). One mistake often produces several lines.

## What is the fix?

Read iverilog's first line and fix that; run again. `sorry:` lines name constructs iverilog lacks; the [guide's section 8](/dewfpga/docs/#8-what-can-it-not-do) lists them.

```copy
dewfpga sim
```

Since #28, when the line iverilog names is in a design file (not the testbench), `dewfpga sim` goes on: it builds the design the way `dewfpga bit` reads it and simulates that, with a [note [sim-from-build]](/dewfpga/errors/sim-from-build/). This error then comes only when the build refuses the design too (the build's own coded line is above it), or when the testbench is what iverilog cannot compile.

## sim-from-build
step: sim
source: dewfpga sim, after iverilog refused a line of the design
title: design.sv:3: note [sim-from-build]: iverilog cannot compile this design (its lines are above), so the simulation runs on the design as the build reads it: read by yosys' own reader, written back as Verilog (top_sim.elab) and compiled with the testbench and yosys' models of the Xilinx cells. What differs: a # delay in the design is gone, an `ifdef SYNTHESIS branch is taken, and a signal the testbench reaches by its hierarchical name (dut.state) may be renamed or gone.
summary: Not an error: iverilog refused a construct in the design, so the testbench ran against the design as the build elaborates it, read by the reader the note names.
date: 2026-10-04

`dewfpga sim` on a design with a `unique if`, which iverilog 13 does not parse:

```
iverilog -g2012 -o top_sim design.sv tb.sv
design.sv:3: syntax error
design.sv:3: Syntax in assignment statement l-value.
design.sv:3: note [sim-from-build]: iverilog cannot compile this design (its lines are above), so the simulation runs on the design as the build reads it: read by yosys' own reader, written back as Verilog (top_sim.elab) and compiled with the testbench and yosys' models of the Xilinx cells. What differs: a # delay in the design is gone, an `ifdef SYNTHESIS branch is taken, and a signal the testbench reaches by its hierarchical name (dut.state) may be renamed or gone. https://nosey-dewdrop.github.io/dewfpga/errors/sim-from-build/
iverilog -g2012 -l /opt/homebrew/share/yosys/xilinx/cells_sim.v -o top_sim top_sim.elab tb.sv
PASS
tb.sv:12: $finish called at 8 (1s)
```

## Why does it happen?

Icarus Verilog is the simulator, and it refuses SystemVerilog that Vivado and the build accept: `unique if` and `priority if`, a modport as a port type, an unpacked struct or union, streaming (`{<<{...}}`), an array compared, copied or sliced whole, a parameter of array type, `type()`, a static class member, a name used before its declaration, an assignment inside an expression, a `$realtobits` parameter. It also has no model of the Xilinx primitives (`BUFG`, and `LUT2` or `GND` in a module the course hands out as a netlist). Before #28 `dewfpga sim` stopped there with [iverilog-refused](/dewfpga/errors/iverilog-refused/), while `dewfpga bit` built the design.

Now, when iverilog's first error is in a design file, `dewfpga sim` runs the build's front half, exactly as `dewfpga bit` does: the same scans ([isunknown-in-design](/dewfpga/errors/isunknown-in-design/), [package-file-not-given](/dewfpga/errors/package-file-not-given/), [ref-argument](/dewfpga/errors/ref-argument/)), yosys' own reader first and [yosys-slang](/dewfpga/errors/read-with-slang/) when it refuses, and the same checks on what they read ([undeclared-name](/dewfpga/errors/undeclared-name/), [two-always-drivers](/dewfpga/errors/two-always-drivers/), [async-reset-nonconst](/dewfpga/errors/async-reset-nonconst/) ...). The elaborated design the build leaves in `top.il` is written back as plain Verilog (`top_sim.elab`, next to your files; `dewfpga clean` removes it) and compiled with your testbench and yosys' simulation models of the Xilinx cells (`cells_sim.v`, as `-l`: a library, so only the cells your design uses are read). The note names the line iverilog refused and the reader that read the design.

A design the build refuses is refused here too, with the build's coded line and then iverilog's:

```
iverilog -g2012 -o top_sim design.sv tb.sv
design.sv:2: sorry: Reference ports not supported yet.
design.sv:2: error: Function tb.dut.inc port x is not an input port.
2 error(s) during elaboration.
design.sv:2: ERROR [ref-argument]: function inc takes an argument by reference (ref logic [3:0] x): yosys does not read ref, and yosys-slang drops it, so the variable it is called with would never change on the board. Fix: pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);). https://nosey-dewdrop.github.io/dewfpga/errors/ref-argument/
design.sv:2: ERROR [iverilog-refused]: iverilog cannot compile this code (its message is above), and the build refuses the design too (its lines are above). Fix: fix the first line it names; the errors after the first often follow from it. https://nosey-dewdrop.github.io/dewfpga/errors/iverilog-refused/
```

An error in the testbench is iverilog's verdict alone, as before: the second path is for the design.

## What differs from simulating your source?

- A `#` delay inside the design is gone (synthesis has no delays); delays in the testbench stay.
- The design is read with `SYNTHESIS` defined, as Vivado and the build read it: an `` `ifdef SYNTHESIS `` branch is taken, an `` `ifndef SYNTHESIS `` block is dropped.
- Internal signals keep their names when they are declared (`cnt`, `state`), but a struct, an enum or an interface becomes plain vectors, and an expression's temporary gets a generated name (`_3_`): a hierarchical reference from the testbench (`dut.state`, `dut.bus.a`) may not find what it names. Check the ports instead, as the board does.
- A Xilinx cell without a simulation model (`MMCME2_BASE`) stops this path too; the error then says so.
- The top module's parameters are the defaults the build uses: a testbench that sets them (`top #(.W(2)) dut`) stops with [sim-from-build-parameters](/dewfpga/errors/sim-from-build-parameters/).
- `$display` in the design still prints; `$readmemh` tables are built in.

## What is the fix?

Nothing: the note says what ran. To make iverilog read the source itself, rewrite the construct it names (`unique if` as a plain `if`, a struct as separate signals, a copy of an array as a loop).

```copy
dewfpga sim
```

## sim-from-build-parameters
step: sim
source: dewfpga sim, after iverilog refused a line of the design
title: top_tb.sv:3: ERROR [sim-from-build-parameters]: iverilog cannot compile the design (its lines are above), and the testbench sets parameters of top with #(...): the simulation of the design as the build reads it keeps top's parameters at their defaults, as the bitstream does, so the testbench's values would not apply and its checks would test another design. Fix: rewrite the line iverilog names above so that iverilog compiles the design itself (the page lists what to write instead of each construct), or test top with its defaults (no #(...) in the testbench).
summary: iverilog refused the design and the testbench sets the top module's parameters; the simulation of the design as the build reads it cannot apply them, so it stops instead of testing another design.
date: 2026-10-06

`dewfpga sim` on a design with a `unique if` and a parameter `W`, tested by a testbench that sets `W` to 2:

```
iverilog -g2012 -o top_sim top.sv top_tb.sv
top.sv:3: syntax error
top.sv:3: Syntax in assignment statement l-value.
top_tb.sv:3: ERROR [sim-from-build-parameters]: iverilog cannot compile the design (its lines are above), and the testbench sets parameters of top with #(...): the simulation of the design as the build reads it keeps top's parameters at their defaults, as the bitstream does, so the testbench's values would not apply and its checks would test another design. Fix: rewrite the line iverilog names above so that iverilog compiles the design itself (the page lists what to write instead of each construct), or test top with its defaults (no #(...) in the testbench). https://nosey-dewdrop.github.io/dewfpga/errors/sim-from-build-parameters/
```

## Why does it happen?

When iverilog refuses a construct in the design, `dewfpga sim` normally runs the testbench against the design as the build elaborates it ([sim-from-build](/dewfpga/errors/sim-from-build/)). The build fixes the top module's parameters at their defaults, because that is the design the bitstream holds. A testbench that writes `top #(.W(2)) dut(...)` expects a top with `W = 2`; the elaborated design has none left to set, so its checks would run against `W = 8`. Vivado's simulator applies the testbench's values to the source; this path cannot, so it stops and says why instead of reporting a result for another design.

## What is the fix?

Either rewrite the construct iverilog names on the first line (`unique if` as a plain `if`, a struct as separate signals, an array copy as a loop: [sim-from-build](/dewfpga/errors/sim-from-build/) lists the usual ones), so that iverilog simulates your source and applies `#(...)` itself; or test the top module with its default parameters (drop `#(...)` from the instance in the testbench).

```copy
dewfpga sim
```

## sim-timeout
step: sim
source: dewfpga sim, vvp
title: ERROR [sim-timeout]: the simulation did not finish in 120 s: the testbench never reached $finish (a free-running clock never stops on its own). Fix: end the testbench with $finish; SIM_TIMEOUT=600 dewfpga sim waits longer.
summary: The testbench never called $finish, or needs longer than the timeout; the CLI killed the simulator.
date: 2026-09-27

```
ERROR [sim-timeout]: the simulation did not finish in 120 s: the testbench never reached $finish (a free-running clock never stops on its own). Fix: end the testbench with $finish; SIM_TIMEOUT=600 dewfpga sim waits longer. https://nosey-dewdrop.github.io/dewfpga/errors/sim-timeout/
```

## Why does it happen?

An `always #5 clk = ~clk;` runs forever; only `$finish` ends the run. A testbench that waits for a condition the design never reaches (a counter to 50 million at 100 MHz takes a long simulated second) hits the timeout too.

## What is the fix?

End the testbench with `$finish`, and shorten long waits (a smaller parameter for the count in simulation). More time when it is really needed:

```copy
SIM_TIMEOUT=600 dewfpga sim
```

## sim-exit
step: sim
source: dewfpga sim, vvp
title: ERROR [sim-exit]: the simulator stopped with exit 1 (its message is above: a $fatal, or a testbench that ends without $finish). Fix: read the line above this one and fix what it names; make the testbench end with $finish.
summary: vvp ended with a non-zero exit: a $fatal in the testbench, or a run that ended without $finish.
date: 2026-09-27

```
FATAL: blink_tb.sv:35: stopped on purpose
       Time: 200000  Scope: blink_tb
ERROR [sim-exit]: the simulator stopped with exit 1 (its message is above: a $fatal, or a testbench that ends without $finish). Fix: read the line above this one and fix what it names; make the testbench end with $finish. https://nosey-dewdrop.github.io/dewfpga/errors/sim-exit/
```

## Why does it happen?

`$fatal` ends the simulation with an error exit on purpose: the testbench found something it cannot continue from. The line before this one is its message.

## What is the fix?

Fix what the `$fatal` line names in the design, or the check if its expectation is wrong; a check that should only be reported uses `$error` and lets the run end with `$finish`.

```copy
if (led !== expected) $error("led is %h, expected %h", led, expected);
```

## testbench-error
step: sim
source: dewfpga sim, after vvp
title: blink_tb.sv:17: ERROR [testbench-error]: the testbench reported 2 errors (its ERROR: lines above, from $error): the design does not do what the testbench expects. Fix: read the first ERROR: line, it names the check that failed; fix the design there, or the testbench if its expectation is wrong.
summary: The simulation ran to $finish, and the testbench printed ERROR: lines with $error: a check failed.
date: 2026-09-27

The file:line is the testbench's first `$error`.

```
ERROR: blink_tb.sv:17: led[0] should follow sw[0]
FAIL: 2 of 3 checks
blink_tb.sv:17: ERROR [testbench-error]: the testbench reported 2 errors (its ERROR: lines above, from $error): the design does not do what the testbench expects. Fix: read the first ERROR: line, it names the check that failed; fix the design there, or the testbench if its expectation is wrong. https://nosey-dewdrop.github.io/dewfpga/errors/testbench-error/
```

## Why does it happen?

`$error` prints a line starting with `ERROR:` and continues; the CLI counts those lines when the run ends and exits 1 when there are any, so a failed check is never silent.

## What is the fix?

The first `ERROR:` line names the check and its line in the testbench; the waveform (`blink.vcd`, the simulator page) shows what the design did instead.

```copy
dewfpga sim
```

## packed-typedef-2d
step: bit
source: dewfpga sim / bit, the typedef scan before the tools run
title: design.sv:4: ERROR [packed-typedef-2d]: SEG is declared with the type tab_t, a packed array with two dimensions (design.sv:3): yosys keeps a value of such a typedef as one flat vector, so SEG[i] picks one bit instead of one row, and the table would be built wrong. Fix: write the dimensions on the declaration itself:  logic [3:0][6:0] SEG;  a parameter yosys refuses in that form, so keep it flat and take a row with +:  (localparam logic [N*W-1:0] SEG = {...}; SEG[i*W +: W]).
summary: A typedef of a two-dimensional packed array used to declare a parameter or a net; yosys flattens the type and every row index picks one bit.
date: 2026-09-27

```
design.sv:4: ERROR [packed-typedef-2d]: SEG is declared with the type tab_t, a packed array with two dimensions (design.sv:3): yosys keeps a value of such a typedef as one flat vector, so SEG[i] picks one bit instead of one row, and the table would be built wrong. Fix: write the dimensions on the declaration itself:  logic [3:0][6:0] SEG;  a parameter yosys refuses in that form, so keep it flat and take a row with +:  (localparam logic [N*W-1:0] SEG = {...}; SEG[i*W +: W]). https://nosey-dewdrop.github.io/dewfpga/errors/packed-typedef-2d/
```

## Why does it happen?

`typedef logic [3:0][6:0] tab_t;` is fine in Vivado and iverilog. yosys' own reader keeps a value of such a typedef as a 28-bit vector, so `SEG[1]` is bit 1, not row 1, and the table is silently wrong on the board. The scan refuses it before either reader runs.

## What is the fix?

Put the dimensions on the declaration; for a parameter keep it flat and slice with `+:`:

```copy
localparam logic [4*7-1:0] SEG = {7'h7F, 7'h06, 7'h5B, 7'h4F};
assign seg = SEG[i*7 +: 7];
```

## ref-argument
step: bit
source: dewfpga bit, the source scan before the tools run
title: design.sv:2: ERROR [ref-argument]: function inc takes an argument by reference (ref logic [3:0] x): yosys does not read ref, and yosys-slang drops it, so the variable it is called with would never change on the board. Fix: pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);).
summary: A function or task argument passed by reference; yosys' reader stops on it and yosys-slang builds the call as nothing.
date: 2026-09-27

`dewfpga sim` stops before it too, iverilog saying `sorry: Reference ports not supported yet.`

```
design.sv:2: ERROR [ref-argument]: function inc takes an argument by reference (ref logic [3:0] x): yosys does not read ref, and yosys-slang drops it, so the variable it is called with would never change on the board. Fix: pass the value in and return it (function automatic logic [3:0] inc(input logic [3:0] x); ... return x + 1;  and  v = inc(v);). https://nosey-dewdrop.github.io/dewfpga/errors/ref-argument/
```

## Why does it happen?

`ref` arguments are a simulation-time feature that neither open-source reader implements; yosys-slang's silent drop is the worse case, so the scan stops the build with the line.

## What is the fix?

```copy
function automatic logic [3:0] inc(input logic [3:0] x);
  return x + 1;
endfunction
```

and `v = inc(v);` at the call.

## package-file-not-given
step: bit
source: dewfpga sim / bit, the source scan before the tools run (or yosys)
title: design.sv:2: ERROR [package-file-not-given]: cfg_pkg::MAGIC names the package cfg_pkg, which is declared in pkg.sv, and the tools are not given that file (dewfpga hands them the files that hold a module: design.sv): iverilog stops at a syntax error there; yosys would drop the import and build every name of cfg_pkg as an undriven 1-bit wire: x on the board. Fix: add   `include "pkg.sv"   as the first line of design.sv; or move the package into design.sv, above the module.
summary: The package lives in its own file, and the CLI hands the tools only the files that hold a module, so the package is not read.
date: 2026-09-27

```
design.sv:2: ERROR [package-file-not-given]: cfg_pkg::MAGIC names the package cfg_pkg, which is declared in pkg.sv, and the tools are not given that file (dewfpga hands them the files that hold a module: design.sv): iverilog stops at a syntax error there; yosys would drop the import and build every name of cfg_pkg as an undriven 1-bit wire: x on the board. Fix: add   `include "pkg.sv"   as the first line of design.sv; or move the package into design.sv, above the module. https://nosey-dewdrop.github.io/dewfpga/errors/package-file-not-given/
```

## Why does it happen?

Vivado projects list the package file among the sources, in order. The CLI has no project file: it gives the tools the files that declare a module, so a file holding only a package is left out, and yosys would silently drop the import.

## What is the fix?

```copy
`include "pkg.sv"
```

as the first line of the file that uses the package, or move the package into that file above the module.

## package-not-found
step: bit
source: dewfpga sim / bit, the source scan before the tools run
title: design.sv:2: ERROR [package-not-found]: `import cfg_pkg::*` names the package cfg_pkg, and no file in this folder declares it (package cfg_pkg; ... endpackage). Fix: check the spelling, or add the file that declares it and `include it as the first line of design.sv.
summary: An import or pkg::NAME names a package no file in the folder declares.
date: 2026-09-27

```
design.sv:2: ERROR [package-not-found]: `import cfg_pkg::*` names the package cfg_pkg, and no file in this folder declares it (package cfg_pkg; ... endpackage). Fix: check the spelling, or add the file that declares it and `include it as the first line of design.sv. https://nosey-dewdrop.github.io/dewfpga/errors/package-not-found/
```

## Why does it happen?

The package file was not copied with the lab, or the name is misspelt. Without it yosys would drop the import and build every name from it as an undriven wire.

## What is the fix?

Copy the package's file into the folder and include it:

```copy
`include "cfg_pkg.sv"
```

## isunknown-in-design
step: bit
source: dewfpga bit, the source scan before yosys
title: design.sv:2: ERROR [isunknown-in-design]: $isunknown in a design: on the board a signal is never x, so it is 0 there (and dewfpga sim shows 0); yosys folds it to the constant 1 instead, so the bitstream would not do what the simulation showed. Fix: remove it from the design; $isunknown belongs in the testbench.
summary: $isunknown in synthesizable code; a chip has no x, and yosys folds the call to a constant that differs from the simulation.
date: 2026-09-27

```
design.sv:2: ERROR [isunknown-in-design]: $isunknown in a design: on the board a signal is never x, so it is 0 there (and dewfpga sim shows 0); yosys folds it to the constant 1 instead, so the bitstream would not do what the simulation showed. Fix: remove it from the design; $isunknown belongs in the testbench. https://nosey-dewdrop.github.io/dewfpga/errors/isunknown-in-design/
```

## Why does it happen?

`x` exists only in simulation. Vivado and the simulator make `$isunknown` 0 on a driven signal; yosys makes it 1, so the two disagree, and the scan refuses it. A `$isunknown` under `` `ifndef SYNTHESIS `` is not reported.

## What is the fix?

Move the check to the testbench:

```copy
if ($isunknown(led)) $error("led is x");
```

## latch
step: bit
source: dewfpga bit, yosys
title: design.sv:3: warning [latch]: latch inferred for q (an if without else in always_comb): q keeps its value when no branch assigns it; Vivado builds the latch too, with the same warning (UG901 Ch.5 Latches). Fix: if you meant a register, write always_ff with a clock; if a latch, always_latch; if neither, give q a value on every path (an else branch, or a default at the top of the block).
summary: A combinational block leaves a signal unassigned on some path, so it has to remember its value: a latch, built as Vivado builds it, with the same warning.
date: 2026-09-27

A warning: the build goes on, with a latch (an LDCE cell) as Vivado would build. When the block's first branch point is a case, the message says "a case without default" and "no item assigns it", and the fix names "a default: item".

```
design.sv:3: warning [latch]: latch inferred for q (an if without else in always_comb): q keeps its value when no branch assigns it; Vivado builds the latch too, with the same warning (UG901 Ch.5 Latches). Fix: if you meant a register, write always_ff with a clock; if a latch, always_latch; if neither, give q a value on every path (an else branch, or a default at the top of the block). https://nosey-dewdrop.github.io/dewfpga/errors/latch/
```

## Why does it happen?

`always_comb if (en) q = d;` says nothing about `q` when `en` is 0, so `q` must hold: that is a latch. Almost always the intent was a register (`always_ff @(posedge clk)`) or a default.

## What is the fix?

```copy
always_comb begin
  q = 1'b0;
  if (en) q = d;
end
```

## latch-loop
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [latch-loop]: latch inferred for q (an if without else in always_comb), and yosys built it as a LUT feedback loop, not a latch, so the board would not do what the simulation showed; Vivado builds an LDCE latch here, with a warning (UG901 Ch.5 Latches). Fix: give q a value on every path (an else branch, or a default at the top of the block); if you meant a latch, write always_latch instead of always_comb (both readers build that as a latch).
summary: A latch the reader turned into a combinational loop instead of a latch cell; the loop does not behave like the simulation, so the build stops.
date: 2026-09-27

```
design.sv:3: ERROR [latch-loop]: latch inferred for q (an if without else in always_comb), and yosys built it as a LUT feedback loop, not a latch, so the board would not do what the simulation showed; Vivado builds an LDCE latch here, with a warning (UG901 Ch.5 Latches). Fix: give q a value on every path (an else branch, or a default at the top of the block); if you meant a latch, write always_latch instead of always_comb (both readers build that as a latch). https://nosey-dewdrop.github.io/dewfpga/errors/latch-loop/
```

## Why does it happen?

Since #4 the CLI makes yosys build an inferred latch as Vivado does (the [latch](/dewfpga/errors/latch/) warning). When the netlist still holds the value in a loop of LUTs instead of a latch cell (a shape the readers keep as logic), the board would glitch, so this is an error.

## What is the fix?

Assign the signal on every path, or say latch when you mean it:

```copy
always_latch if (en) q <= d;
```

## unique-case-overlap
step: sim, bit
source: dewfpga sim and dewfpga bit, the source scan before the tools
title: design.sv:5: ERROR [unique-case-overlap]: the items 4'b10?? (design.sv:4) and 4'b??11 (design.sv:5) of this unique casez both match 4'b1011, and unique promises that only one item can match: the simulation takes the first item (iverilog ignores unique), and the hardware, built as parallel logic the way Vivado builds a unique case (UG901 Ch.10, parallel_case), ORs the two items' values, so the board would not do what the simulation showed. Fix: make the items disjoint (4'b10?? and 4'b0?11), write priority casez when the first match should win, or drop unique.
summary: Two items of a unique casez (or casex) can match the same value; the simulator takes the first, the hardware ORs both, so the board would not do what the simulation showed.
date: 2026-10-07

`dewfpga sim` or `dewfpga bit` on a design whose `unique casez` has two items that overlap:

```
design.sv:5: ERROR [unique-case-overlap]: the items 4'b10?? (design.sv:4) and 4'b??11 (design.sv:5) of this unique casez both match 4'b1011, and unique promises that only one item can match: the simulation takes the first item (iverilog ignores unique), and the hardware, built as parallel logic the way Vivado builds a unique case (UG901 Ch.10, parallel_case), ORs the two items' values, so the board would not do what the simulation showed. Fix: make the items disjoint (4'b10?? and 4'b0?11), write priority casez when the first match should win, or drop unique. https://nosey-dewdrop.github.io/dewfpga/errors/unique-case-overlap/
```

The design that printed it:

```
module top(input logic [15:0] sw, output logic [15:0] led);
  always_comb begin
    led = '0;
    unique casez (sw[3:0])
      4'b10??: led[1:0] = 2'd1;
      4'b??11: led[1:0] = 2'd2;
      default: led[1:0] = 2'd0;
    endcase
  end
endmodule
```

## Why does it happen?

`unique` is a promise, not a priority: it asserts that no two items match at once (IEEE 1800-2017 12.5.3), and every tool is free to build on that promise. The tools disagree on what to do when it is broken. iverilog ignores `unique` and takes the first matching item, so `dewfpga sim` shows `led = 1` for `sw[3:0] = 4'b1011`. yosys, yosys-slang and Vivado (UG901 v2023.2 Ch.10 p.279: a unique case is treated as parallel_case and full_case) build the items as parallel logic with no priority chain, and when two match, their values are ORed: the board shows `led = 3`. Measured on seed 6 of test/fuzz: rtl `0000000000000001`, netlist `0000000000000011`. The same `unique case` with disjoint items, as the course's `18_unique_priority` probe writes it (`unique case (sw[1:0])` with the four constants `2'd0` to `2'd3`), builds the same on every tool.

Because this is a disagreement between the simulator and the hardware that no simulation can show, the source scan stops both commands before the tools run.

The scan reads the patterns, not the values they assign, so it also stops a design whose overlapping items happen to agree: seed 27 of test/fuzz has `4'b??11: s2 = {4{2'd1}}` over `4'b?0?1: s2 = (&btnL)`, whose OR is the first item's value, and its netlist matched its RTL for all 300 cycles before the scan existed. In test/fuzz/run.sh 1 500, 24 of the 500 random designs carry such an overlap; 22 of them built equal, 1 (seed 6) built wrong, 1 (seed 345) was refused by yosys-slang before it could build. The 22 are refused the same way, because the agreement is an accident of the values on that line, not something the design promised.

## What is the fix?

Make the items disjoint, so that only one can ever match:

```copy
    unique casez (sw[3:0])
      4'b10??: led[1:0] = 2'd1;
      4'b0?11: led[1:0] = 2'd2;
      default: led[1:0] = 2'd0;
    endcase
```

If the first match should win, say so: `priority casez` builds the if/else chain the simulation shows. If neither matters, drop `unique`: a plain `casez` is a priority chain in every tool.

## latch-hazard
step: bit
source: dewfpga bit, yosys
title: design.sv:4: warning [latch-hazard]: always_latch builds a latch for led (an LDCE cell, as Vivado builds it, UG901 Ch.5 Latches), and a latch has no clock: when its gate (s < sw) closes in the same instant its data changes, the board keeps the old value or takes the new one depending on which wire is faster, where the simulation always keeps the old one; dewfpga sim cannot show that race. Fix: if a register was meant, write always_ff @(posedge clk) with the gate as its enable:  if (s < sw) led <= ...;  keep always_latch only when the gate is held steady while the data changes.
summary: An always_latch whose gate and data come from the same inputs: when both change at once the board races, where the simulation keeps the old value; the build goes on with the warning.
date: 2026-10-07

A warning: the build goes on, with the latch (an LDCE cell) as Vivado would build it. `dewfpga bit` on a design whose `always_latch` gate and data both depend on `sw`:

```
design.sv:4: warning [latch-hazard]: always_latch builds a latch for led (an LDCE cell, as Vivado builds it, UG901 Ch.5 Latches), and a latch has no clock: when its gate (s < sw) closes in the same instant its data changes, the board keeps the old value or takes the new one depending on which wire is faster, where the simulation always keeps the old one; dewfpga sim cannot show that race. Fix: if a register was meant, write always_ff @(posedge clk) with the gate as its enable:  if (s < sw) led <= ...;  keep always_latch only when the gate is held steady while the data changes. https://nosey-dewdrop.github.io/dewfpga/errors/latch-hazard/
```

The design that printed it, seed 7 of test/fuzz cut down to six lines:

```
module top(input logic [15:0] sw, output logic [15:0] led);
  logic [1:0] s;
  assign s = {sw[1] ^ sw[0], sw[0] ^ sw[1]};
  always_latch
    if (s < sw) led = {15'b0, (sw < 16'd1791)};
endmodule
```

## Why does it happen?

A latch is transparent while its gate is open and holds while it is closed; it has no clock edge to order its inputs. Here the gate `s < sw` and the data `sw < 16'd1791` are both functions of `sw`, so one change of `sw` moves both. The testbench drives `sw` from `16'h2bdc` to `16'h0000`: the gate goes from open to closed and the data from 0 to 1 in the same instant. The RTL simulation evaluates the `if` once, with the new gate value, sees it closed and keeps `led = 0`. The netlist's LDCE gets its G and D through LUTs with different delays: D arrives first, G closes a moment later, and the latch takes `led = 1`. The board does the same, and which one wins depends on the routing, not on the code. 7 of the 27 silent-wrong seeds in 1..500 of test/fuzz were this shape; each becomes equal to its simulation when the latch is made transparent.

The [latch](/dewfpga/errors/latch/) warning names a latch nobody asked for (an `always_comb` that leaves a path unassigned); this one names a latch that was asked for, built right, and still cannot match the simulation. `dewfpga sim` cannot show the race, because iverilog has no delays on the netlist's wires either.

## What is the fix?

Almost always a register was meant. Give it the clock, and the gate as its enable:

```copy
always_ff @(posedge clk)
  if (s < sw) led <= {15'b0, (sw < 16'd1791)};
```

Keep `always_latch` only when the gate is held steady while the data changes (a bus-hold or an address latch with a setup time its driver respects): then the warning tells you what the design counts on.

## async-reset-nonconst
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [async-reset-nonconst]: this always_ff has an asynchronous reset (posedge clk or posedge btnC), so on btnC's edge every signal it writes must get a constant; here q is loaded from sw. yosys emulates that with FFs and a mux, so the board would not do what the simulation showed. Fix: reset to a constant, and load sw with the clock, behind an input of your own (load):  if (btnC) q <= 0; else if (load) q <= sw; else q <= q + 1;
summary: In an always_ff with an asynchronous reset, the reset branch loads a register from a signal, or a signal is written outside the reset if/else; a flip-flop can only reset to a constant.
date: 2026-09-27

Two shapes, two texts. The second comes from yosys' own line above it. When the first if tests the reset at the level its edge leaves (posedge rst with if (!rst)), the code is [async-reset-polarity](/dewfpga/errors/async-reset-polarity/) instead.

```
design.sv:3: ERROR [async-reset-nonconst]: this always_ff has an asynchronous reset (posedge clk or posedge btnC), so on btnC's edge every signal it writes must get a constant; here q is loaded from sw. yosys emulates that with FFs and a mux, so the board would not do what the simulation showed. Fix: reset to a constant, and load sw with the clock, behind an input of your own (load):  if (btnC) q <= 0; else if (load) q <= sw; else q <= q + 1; https://nosey-dewdrop.github.io/dewfpga/errors/async-reset-nonconst/
ERROR: Async reset \btnC yields non-constant value 4'mmmm for signal \d.
design.sv:3: ERROR [async-reset-nonconst]: this always_ff has an asynchronous reset (posedge btnC), so on btnC's edge every signal it writes must get a constant, and d does not: it is written after the if (btnC) ... else ..., or from a signal, so on the reset edge it would load a value no flip-flop on the chip can load. Fix: make the reset if the whole block, with a constant for every signal in its first branch:  if (btnC) begin q <= 0; d <= 0; end else begin q <= ...; d <= ...; end https://nosey-dewdrop.github.io/dewfpga/errors/async-reset-nonconst/
```

## Why does it happen?

`always_ff @(posedge clk, posedge btn)` makes `btn` an asynchronous reset: the flip-flop's set/reset pin, which can only force a constant. `if (btn) q <= sw;` asks the chip to load `sw` on that pin. yosys emulates it with extra flip-flops and a mux (or a loop), Vivado refuses it outright.

## What is the fix?

```copy
always_ff @(posedge clk, posedge btn)
  if (btn) q <= '0;
  else if (load) q <= sw;
  else q <= q + 1;
```

## async-reset-polarity
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [async-reset-polarity]: this always_ff is sensitive to posedge btnC, but its first if tests !btnC, so the reset branch runs while btnC is low and on btnC's rising edge the block takes the else branch, which loads q from sw: no flip-flop on the chip loads a signal on its reset edge (yosys emulates it with FFs and a mux, so the board would not do what the simulation showed). Fix: test btnC at the level its edge leaves it:  if (btnC) q <= 0; else ...;  or keep if (!btnC) and write negedge btnC in the sensitivity list.
summary: The sensitivity list names one edge of the reset and the first if tests the other level, so the reset edge lands in the else branch, which loads a signal.
date: 2026-09-27

Under the CLI's line, yosys-slang's own: it refuses the same block.

```
design.sv:3: ERROR [async-reset-polarity]: this always_ff is sensitive to posedge btnC, but its first if tests !btnC, so the reset branch runs while btnC is low and on btnC's rising edge the block takes the else branch, which loads q from sw: no flip-flop on the chip loads a signal on its reset edge (yosys emulates it with FFs and a mux, so the board would not do what the simulation showed). Fix: test btnC at the level its edge leaves it:  if (btnC) q <= 0; else ...;  or keep if (!btnC) and write negedge btnC in the sensitivity list. https://nosey-dewdrop.github.io/dewfpga/errors/async-reset-polarity/
yosys-slang: design.sv:4:9: error: polarity of condition doesn't match edge sensitivity
        if (!btnC) q <= 4'd0;
            ^~~~~
```

## Why does it happen?

`always_ff @(posedge clk or posedge btnC)` wakes the block when `btnC` rises, and at that moment `btnC` is 1. `if (!btnC)` is then false, so the branch that runs on the reset edge is the else: `q <= sw`. A flip-flop's asynchronous pin can only force a constant, so no cell on the chip does this; yosys emulates it with extra flip-flops and a mux, and the board would not follow the simulation. The reset branch as written runs only on a clock edge while `btnC` is low: a synchronous reset with the wrong sense.

## What is the fix?

Test the reset at the level its edge leaves it, or name the other edge:

```copy
always_ff @(posedge clk or posedge btnC)
  if (btnC) q <= '0;
  else q <= sw;
```

## async-reset-not-alone
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [async-reset-not-alone]: this always block is sensitive to two edges (@(posedge clk, posedge btnC)), so one of them is an asynchronous reset, but its first if does not test that reset alone (a reset ORed with a synchronous clear: if (rst || clear)), so neither reader can tell the reset from the clock. Fix: test the reset alone first and put the synchronous clear in the else:  if (btnC) q <= 0; else if (clear) q <= 0; else q <= q + 1;
summary: The block has a clock and an asynchronous reset in its sensitivity list, but the first if tests the reset ORed with another signal.
date: 2026-09-27

yosys' own line comes first; the CLI reads which block it was and names the cause.

```
ERROR: Multiple edge sensitive events found for this signal!
design.sv:3: ERROR [async-reset-not-alone]: this always block is sensitive to two edges (@(posedge clk, posedge btnC)), so one of them is an asynchronous reset, but its first if does not test that reset alone (a reset ORed with a synchronous clear: if (rst || clear)), so neither reader can tell the reset from the clock. Fix: test the reset alone first and put the synchronous clear in the else:  if (btnC) q <= 0; else if (clear) q <= 0; else q <= q + 1; https://nosey-dewdrop.github.io/dewfpga/errors/async-reset-not-alone/
```

## Why does it happen?

The reader pairs the second edge in the list with the first `if` of the block; `if (btnC || btnU)` names two signals, and only one of them is in the list, so the pattern does not match and neither reader can build the flip-flop.

## What is the fix?

```copy
if (btnC) q <= '0;
else if (btnU) q <= '0;
else q <= q + 1;
```

## dual-edge
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [dual-edge]: this always block is sensitive to both edges of clk (@(posedge clk or negedge clk)), so cnt would change on every edge: no flip-flop on the chip does that, and neither reader builds it. Fix: clock the block on one edge (always_ff @(posedge clk)); for twice the rate use a faster clock (the Basys3's is 100 MHz) or count on both phases with two registers.
summary: One always block clocked on posedge and negedge of the same clock; the chip's flip-flops have one clock edge.
date: 2026-09-27

```
ERROR: Multiple edge sensitive events found for this signal!
design.sv:3: ERROR [dual-edge]: this always block is sensitive to both edges of clk (@(posedge clk or negedge clk)), so cnt would change on every edge: no flip-flop on the chip does that, and neither reader builds it. Fix: clock the block on one edge (always_ff @(posedge clk)); for twice the rate use a faster clock (the Basys3's is 100 MHz) or count on both phases with two registers. https://nosey-dewdrop.github.io/dewfpga/errors/dual-edge/
```

## Why does it happen?

A 7-series flip-flop clocks on one edge. Dual-edge registers simulate fine and exist on no FPGA; Vivado refuses them too.

## What is the fix?

```copy
always_ff @(posedge clk) cnt <= cnt + 1;
```

## initial-from-signal
step: bit
source: dewfpga bit, yosys
title: design.sv:3: ERROR [initial-from-signal]: `num = sw` here is a start value, not a wire: it reads sw once, at time 0 (IEEE 1800-2017 6.8), and the chip has no power-up value that follows a signal, so yosys stops. Fix: for a wire write  assign num = sw;  for a register give num a constant start value (logic [15:0] num = '0;) and load sw with the clock (if (btnC) num <= sw;).
summary: An initial block, or a declaration, sets a register's start value from a signal; power-up values are constants.
date: 2026-09-27

```
ERROR: Failed to get a constant init value for \num: \sw
design.sv:3: ERROR [initial-from-signal]: `num = sw` here is a start value, not a wire: it reads sw once, at time 0 (IEEE 1800-2017 6.8), and the chip has no power-up value that follows a signal, so yosys stops. Fix: for a wire write  assign num = sw;  for a register give num a constant start value (logic [15:0] num = '0;) and load sw with the clock (if (btnC) num <= sw;). https://nosey-dewdrop.github.io/dewfpga/errors/initial-from-signal/
```

## Why does it happen?

`initial num = sw;` is evaluated once at time 0 in simulation. On the chip a register's start value is written into the bitstream, a constant; nothing can follow `sw`.

## What is the fix?

```copy
assign num = sw;
```

## two-always-drivers
step: bit
source: dewfpga bit, yosys
title: design.sv:3 and design.sv:4: ERROR [two-always-drivers]: cnt is written from two always blocks (design.sv:3 and design.sv:4): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive cnt from one always block (merge the two, or give each block its own signal).
summary: The same register is assigned in two always blocks; yosys resolves the conflict silently, Vivado refuses it.
date: 2026-09-27

yosys' own warnings name only cells; the CLI reads the cells' source lines from the elaborated design and names both blocks.

```
Warning: multiple conflicting drivers for top.\cnt [3]:
    port Q[3] of cell $driver$cnt_1 ($dff)
    port Q[3] of cell $driver$cnt ($dff)
design.sv:3 and design.sv:4: ERROR [two-always-drivers]: cnt is written from two always blocks (design.sv:3 and design.sv:4): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive cnt from one always block (merge the two, or give each block its own signal). https://nosey-dewdrop.github.io/dewfpga/errors/two-always-drivers/
```

## Why does it happen?

Each always block becomes its own set of flip-flops; two blocks writing one signal are two drivers on one wire. The simulator picks the last write; the chip cannot.

## What is the fix?

```copy
always_ff @(posedge clk)
  if (btnC) cnt <= '0;
  else cnt <= cnt + 1;
```

## always-and-assign
step: bit
source: dewfpga bit, yosys
title: design.sv:4 and design.sv:6: ERROR [always-and-assign]: q is written by an always block (design.sv:4) and by a continuous assign (design.sv:6): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive q from one of them.
summary: A signal assigned both in an always block and with assign; two drivers on one wire.
date: 2026-09-27

```
design.sv:4 and design.sv:6: ERROR [always-and-assign]: q is written by an always block (design.sv:4) and by a continuous assign (design.sv:6): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive q from one of them. https://nosey-dewdrop.github.io/dewfpga/errors/always-and-assign/
```

## Why does it happen?

`assign` is a permanent driver; the always block is another. yosys resolves the conflict to a constant with a warning, and the netlist no longer matches the RTL.

## What is the fix?

Keep one: register it in the always block, or make it a wire with the assign.

```copy
assign q = d & en;
```

## two-assign-drivers
step: bit
source: dewfpga bit, yosys
title: design.sv:2 and design.sv:3: ERROR [two-assign-drivers]: led is written by two continuous assigns (design.sv:2 and design.sv:3): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive led from one assign (select with a mux:  assign led = sel ? b : a;).
summary: A signal with two assign lines; two drivers on one wire.
date: 2026-09-27

```
design.sv:2 and design.sv:3: ERROR [two-assign-drivers]: led is written by two continuous assigns (design.sv:2 and design.sv:3): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive led from one assign (select with a mux:  assign led = sel ? b : a;). https://nosey-dewdrop.github.io/dewfpga/errors/two-assign-drivers/
```

## Why does it happen?

Every `assign` is a permanent driver. Two of them on one wire fight; on the chip a wire has one driver, so yosys resolves the conflict to a constant with a warning, and the netlist no longer matches the RTL. The second line of the message names both assigns.

## What is the fix?

One assign, with the choice written as a mux:

```copy
assign led = sel ? ~sw : sw;
```

## multiple-drivers
step: bit
source: dewfpga bit, yosys
title: design.sv:3 and design.sv:7: ERROR [multiple-drivers]: q is written from more than one place (design.sv:3 and design.sv:7): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive q from one always block or one assign; give each other writer its own signal.
summary: A signal written from more than one place that the checker could not sort into always blocks and assigns; two drivers on one wire.
date: 2026-09-27

```
design.sv:3 and design.sv:7: ERROR [multiple-drivers]: q is written from more than one place (design.sv:3 and design.sv:7): yosys resolved the conflict to a constant, so the board would not do what the simulation showed. Fix: drive q from one always block or one assign; give each other writer its own signal. https://nosey-dewdrop.github.io/dewfpga/errors/multiple-drivers/
```

## Why does it happen?

yosys found two drivers on the signal (its "multiple conflicting drivers" warning) and resolved them to a constant. When the two writers are two always blocks, an always block and an assign, or two assigns, dewfpga names that case ([two-always-drivers](../two-always-drivers/), [always-and-assign](../always-and-assign/), [two-assign-drivers](../two-assign-drivers/)); this is the general message, printed when the writers are something else (a task, an instance port and an assign) or when the scan could not read them. The lines are the ones yosys named.

## What is the fix?

Look at the lines named: every signal gets one writer. Two always blocks merge into one; an assign next to an always block goes into the block; a submodule output and an assign on the same wire get two wires.

## undeclared-name
step: bit
source: dewfpga bit, yosys
title: design.sv:4: ERROR [undeclared-name]: summ is not declared anywhere and nothing drives it: yosys made it a 1-bit wire stuck at x and built the design without it (dewfpga sim refuses this code). Fix: declare it, or check the spelling (a typo of a declared name).
summary: A name used but never declared; yosys' reader makes an implicit 1-bit wire with no driver, so the design would be built without it.
date: 2026-09-27

```
design.sv:4: ERROR [undeclared-name]: summ is not declared anywhere and nothing drives it: yosys made it a 1-bit wire stuck at x and built the design without it (dewfpga sim refuses this code). Fix: declare it, or check the spelling (a typo of a declared name). https://nosey-dewdrop.github.io/dewfpga/errors/undeclared-name/
yosys-slang: design.sv:4:21: error: use of undeclared identifier 'summ'; did you mean 'sum'?
```

## Why does it happen?

Verilog's implicit nets: an undeclared name on a port connection or the right of an assign becomes a 1-bit wire. yosys warns and goes on; the CLI turns the warning into a stop when nothing drives that wire. yosys-slang, the second reader, often suggests the intended name.

## What is the fix?

Fix the spelling, or declare the signal:

```copy
assign led[3:0] = sum;
```

## hierarchical-name
step: bit
source: dewfpga bit, yosys (when yosys-slang is not installed)
title: design.sv:7: ERROR [hierarchical-name]: u_cnt.count is a hierarchical name (a signal inside another instance). yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); Vivado resolves hierarchical names (UG901 Ch.9 Table 20). Fix: bring that signal out through an output port of its module and connect it here.
summary: A signal reached through an instance name (u_cnt.count); yosys' own reader does not resolve it. With yosys-slang installed the design builds, with the read-with-slang note.
date: 2026-09-27

```
design.sv:7: ERROR [hierarchical-name]: u_cnt.count is a hierarchical name (a signal inside another instance). yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); Vivado resolves hierarchical names (UG901 Ch.9 Table 20). Fix: bring that signal out through an output port of its module and connect it here. https://nosey-dewdrop.github.io/dewfpga/errors/hierarchical-name/
```

## Why does it happen?

yosys' own reader treats `u_cnt.count` as a new implicit wire. yosys-slang resolves it, so with the second reader installed this line does not print; it appears with [second-reader-missing](/dewfpga/errors/second-reader-missing/).

## What is the fix?

Run `dewfpga install` for the second reader, or bring the signal out through a port:

```copy
counter u_cnt(.clk(clk), .count(count));
```

## interface-member
step: bit
source: dewfpga bit, yosys (when yosys-slang is not installed)
title: design.sv:9: ERROR [interface-member]: bus.data is a member of the interface instance bus, used in the module that instantiates it. yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); an interface used this way is not supported yet (#4). Fix: pass the interface to a module through an interface port, or keep those signals as plain logic in the module.
summary: A member of an interface instance read in the module that declares the instance; yosys' own reader makes an undriven wire of it. With yosys-slang installed the design builds.
date: 2026-09-27

```
design.sv:9: ERROR [interface-member]: bus.data is a member of the interface instance bus, used in the module that instantiates it. yosys does not resolve it (it made a 1-bit wire with no driver, so the board would not do what the simulation showed); an interface used this way is not supported yet (#4). Fix: pass the interface to a module through an interface port, or keep those signals as plain logic in the module. https://nosey-dewdrop.github.io/dewfpga/errors/interface-member/
```

## Why does it happen?

yosys' own reader knows interfaces only as ports of a module; `bus.data` in the instantiating module is a hierarchical name to it. yosys-slang reads it, so this line appears only when the second reader is missing.

## What is the fix?

```copy
dewfpga install
```

## module-not-found
step: bit
source: dewfpga bit, yosys
title: design.sv:5: ERROR [module-not-found]: the module counter is instantiated here, and no file the build was given declares it (dewfpga reads the files that hold a module: design.sv). Fix: put the file that declares counter in this folder, or check the spelling of the module name.
summary: An instance of a module no file in the folder declares.
date: 2026-09-27

```
ERROR: Module `\counter' referenced in module `\top' in cell `\u_cnt' is not part of the design.
design.sv:5: ERROR [module-not-found]: the module counter is instantiated here, and no file the build was given declares it (dewfpga reads the files that hold a module: design.sv). Fix: put the file that declares counter in this folder, or check the spelling of the module name. https://nosey-dewdrop.github.io/dewfpga/errors/module-not-found/
```

## Why does it happen?

The submodule's file was not copied with the lab, or the instance names it with a typo. yosys' own line names cells; the CLI finds the instance's line in your file.

## What is the fix?

```copy
cp ../lab3/counter.sv .
```

## enum-method-next-prev
step: bit
source: dewfpga bit, yosys-slang
title: design.sv:5: ERROR [enum-method-next-prev]: s.next() is an enum method that steps through the values (next/prev): yosys does not build enum methods, and yosys-slang builds first()/last() only; Vivado builds next/prev (UG901 Ch.10 Table 27). Fix: write the step out as a case on s, in the order the enum lists its values (with IDLE, RUN, DONE: case (s) IDLE: s <= RUN; RUN: s <= DONE; DONE: s <= IDLE; endcase).
summary: The enum methods next() and prev(); neither reader builds them, Vivado does.
date: 2026-09-27

```
yosys' reader:
  design.sv:5: ERROR: Can't resolve function name `\s.first'.
design.sv:5: ERROR [enum-method-next-prev]: s.next() is an enum method that steps through the values (next/prev): yosys does not build enum methods, and yosys-slang builds first()/last() only; Vivado builds next/prev (UG901 Ch.10 Table 27). Fix: write the step out as a case on s, in the order the enum lists its values (with IDLE, RUN, DONE: case (s) IDLE: s <= RUN; RUN: s <= DONE; DONE: s <= IDLE; endcase). https://nosey-dewdrop.github.io/dewfpga/errors/enum-method-next-prev/
```

## Why does it happen?

yosys' own reader has no enum methods; yosys-slang implements `first()` and `last()` and stops at `next()`/`prev()`. A known gap of the chain.

## What is the fix?

```copy
case (s) IDLE: s <= RUN; RUN: s <= DONE; DONE: s <= IDLE; endcase
```

## slang-refused
step: bit
source: dewfpga bit, yosys-slang, after yosys' own reader refused the code
title: blink.v:8: ERROR [slang-refused]: use of undeclared identifier 'logic' (yosys-slang, the second reader; yosys' own reader refused this code too, its line is above). Fix: the caret below marks the construct; the page lists the usual ones and what to write instead.
summary: Both readers refused the code; yosys' own line is printed first, then yosys-slang's error with its caret.
date: 2026-09-27

```
yosys' reader:
  blink.v:8: ERROR: syntax error, unexpected TOK_ID, expecting ')' or ',' or '='
blink.v:8: ERROR [slang-refused]: use of undeclared identifier 'logic' (yosys-slang, the second reader; yosys' own reader refused this code too, its line is above). Fix: the caret below marks the construct; the page lists the usual ones and what to write instead. https://nosey-dewdrop.github.io/dewfpga/errors/slang-refused/
        input  logic        clk,      // W5: 100 MHz on-board oscillator
               ^~~~~
```

## Why does it happen?

A syntax error (a missing `end`, a `default` outside its case), or a construct in a `.v` file that Verilog-2005 lacks (`logic` above: see [v-is-verilog-2005](/dewfpga/errors/v-is-verilog-2005/)), or SystemVerilog the readers do not build yet. The usual ones and what to write instead are in the [guide's section 8](/dewfpga/docs/#8-what-can-it-not-do).

## What is the fix?

Read yosys-slang's message and the caret; fix the first one, the later ones often follow from it. A `.v` file holding SystemVerilog:

```copy
mv blink.v blink.sv
```

## slang-unimplemented
step: bit
source: dewfpga bit, yosys-slang, after yosys' own reader refused the code
title: ERROR [slang-unimplemented]: yosys-slang cannot build a construct of this design yet (ERROR: Feature unimplemented at slang_frontend.cc:776, see AST and code line dump above), and yosys' own reader refused the code too (its line is above). Fix: take the design apart until the build goes through, and report that construct (github.com/nosey-dewdrop/dewfpga/issues).
summary: yosys-slang stops on a construct it has no implementation for, without a line; the code line dump above it shows the construct.
date: 2026-09-27

```
ERROR [slang-unimplemented]: yosys-slang cannot build a construct of this design yet (ERROR: Feature unimplemented at slang_frontend.cc:776, see AST and code line dump above), and yosys' own reader refused the code too (its line is above). Fix: take the design apart until the build goes through, and report that construct (github.com/nosey-dewdrop/dewfpga/issues). https://nosey-dewdrop.github.io/dewfpga/errors/slang-unimplemented/
```

## Why does it happen?

yosys-slang covers most of SystemVerilog and stops on the rest with this line; a real-valued parameter (`localparam MAX = 1e1`) is one known case, reported as [yosys-crashed](/dewfpga/errors/yosys-crashed/) when yosys' own reader crashed on it.

## What is the fix?

Comment out half the design until it builds, then the other half: the construct that stops it is what to rewrite or report.

```copy
dewfpga bit
```

## yosys-crashed
step: bit
source: dewfpga bit, yosys
title: design.sv:2: ERROR [yosys-crashed]: yosys' own reader crashed (Segmentation fault: 11) without a message, and this line holds a real number (1e1): a real value in a parameter (localparam MAX = 1e1) is a known cause. Fix: write the value as an integer (10, 50_000_000).
summary: yosys died with a signal instead of an error message; a real literal in a parameter is the known cause, and the line that holds one is named.
date: 2026-09-27

```
design.sv:2: ERROR [yosys-crashed]: yosys' own reader crashed (Segmentation fault: 11) without a message, and this line holds a real number (1e1): a real value in a parameter (localparam MAX = 1e1) is a known cause. Fix: write the value as an integer (10, 50_000_000). https://nosey-dewdrop.github.io/dewfpga/errors/yosys-crashed/
yosys-slang: ERROR: Feature unimplemented at slang_frontend.cc:776, see AST and code line dump above
```

## Why does it happen?

yosys 0.69 segfaults on `localparam int MAX = 1e1;` (a real in a parameter expression); the shell sees only the signal. The CLI looks for a real literal in the sources to name the line; without one it prints the crash alone and asks for a report.

## What is the fix?

```copy
localparam int MAX = 10;
```

## second-reader-missing
step: bit
source: dewfpga bit, after yosys' own reader refused the code
title: note [second-reader-missing]: yosys' own reader refused this code, and yosys-slang, the second reader (it reads the SystemVerilog Vivado accepts: interfaces, unpacked arrays, foreach, break, enum methods first/last ...), is not installed: /Users/you/fpga/yosys-slang/build/slang.so not found. Fix: run  dewfpga install  (it builds that reader, ~3 min), then build again.
summary: The code needs the second reader, and it is not built; the error above it may go away with it.
date: 2026-09-27

Printed after the error of yosys' own reader, when the plugin is not there.

```
note [second-reader-missing]: yosys' own reader refused this code, and yosys-slang, the second reader (it reads the SystemVerilog Vivado accepts: interfaces, unpacked arrays, foreach, break, enum methods first/last ...), is not installed: /Users/you/fpga/yosys-slang/build/slang.so not found. Fix: run  dewfpga install  (it builds that reader, ~3 min), then build again. https://nosey-dewdrop.github.io/dewfpga/errors/second-reader-missing/
```

## Why does it happen?

Since #4 the CLI tries yosys-slang when yosys' own reader refuses the code. An install from before #4, or an interrupted one, has no `slang.so`.

## What is the fix?

```copy
dewfpga install
```

## read-with-slang
step: bit
source: dewfpga bit, synthesis
title: note [read-with-slang]: top read with yosys-slang, the second reader (yosys' own reader refused this code; the build is the same from here).
summary: Not an error: yosys' own reader refused the code, yosys-slang read it, and synthesis went on as usual.
date: 2026-09-27

```
note [read-with-slang]: top read with yosys-slang, the second reader (yosys' own reader refused this code; the build is the same from here). https://nosey-dewdrop.github.io/dewfpga/errors/read-with-slang/
```

## Why does it happen?

Interfaces, unpacked arrays, `foreach`, `break`, hierarchical names, string parameters: SystemVerilog Vivado accepts and yosys' own reader does not. The second reader takes over, and the netlist is checked the same way.

## What is the fix?

Nothing. The note says which reader built the design, in case a later message names a construct.

## v-is-verilog-2005
step: bit
source: dewfpga bit, after both readers refused a .v file
title: note [v-is-verilog-2005]: a .v file is read as Verilog-2005 by both readers, as Vivado reads it (UG901 Ch.10): SystemVerilog (logic, always_ff, always_comb, enum ...) belongs in a .sv file. Fix: if your .v file holds SystemVerilog, rename it to .sv.
summary: A .v file that holds SystemVerilog; both readers, like Vivado, read .v as Verilog-2005, so logic and always_ff are syntax errors there.
date: 2026-09-27

```
yosys' reader:
  blink.v:8: ERROR: syntax error, unexpected TOK_ID, expecting ')' or ',' or '='
note [v-is-verilog-2005]: a .v file is read as Verilog-2005 by both readers, as Vivado reads it (UG901 Ch.10): SystemVerilog (logic, always_ff, always_comb, enum ...) belongs in a .sv file. Fix: if your .v file holds SystemVerilog, rename it to .sv. https://nosey-dewdrop.github.io/dewfpga/errors/v-is-verilog-2005/
blink.v:8: ERROR [slang-refused]: use of undeclared identifier 'logic' (yosys-slang, the second reader; yosys' own reader refused this code too, its line is above). Fix: the caret below marks the construct; the page lists the usual ones and what to write instead. https://nosey-dewdrop.github.io/dewfpga/errors/slang-refused/
```

## Why does it happen?

Vivado picks the language by the extension (UG901 Ch.10), and so does the CLI, so a `.v` behaves the same in both: `logic` is not a Verilog-2005 keyword.

## What is the fix?

```copy
mv blink.v blink.sv
```

## no-create-clock
step: bit
source: dewfpga bit, before place and route
title: note [no-create-clock]: no create_clock in Basys3_Master.xdc; timing is checked against the Basys3's 100 MHz oscillator (--freq 100).
summary: Not an error: the XDC has no create_clock line, so every clock is checked at the board's 100 MHz.
date: 2026-09-27

```
note [no-create-clock]: no create_clock in Basys3_Master.xdc; timing is checked against the Basys3's 100 MHz oscillator (--freq 100). https://nosey-dewdrop.github.io/dewfpga/errors/no-create-clock/
```

## Why does it happen?

The course's master XDC ships with its `create_clock` line commented out. Without it nextpnr would check nothing; the CLI asks for 100 MHz, the oscillator's rate, so a design that cannot keep up is caught ([timing-not-met](/dewfpga/errors/timing-not-met/)).

## What is the fix?

Nothing, or uncomment the clock line for a clock of your own period:

```copy
create_clock -add -name sys_clk_pin -period 10.00 -waveform {0 5} [get_ports clk]
```

## internal-tristate
step: bit
source: dewfpga bit, nextpnr
title: design.sv:2: ERROR [internal-tristate]: a tri-state driver (a z, at design.sv:2) on a signal that is not an inout pin of the top module: the chip has tri-state buffers on its pins only. Vivado converts such a driver to logic (UG901 Ch.5 Tristates); yosys keeps it as a $_TBUF_ cell, and nextpnr has nothing to place it on. Not a size problem. Fix: select with a mux instead:  assign bus = sel ? b : a;  and keep z for an inout pin only.
summary: A z driven onto an internal signal or a submodule port; the chip's tri-state buffers sit on pins only, and yosys keeps the buffer as a cell nextpnr cannot place.
date: 2026-09-27

nextpnr's own line first (`no Bels remaining of type '$_TBUF_'`, which reads like a size problem); the CLI names the real cause and the line with the `z`.

```
ERROR: Unable to place cell '$auto$simplemap.cc:331:simplemap_tribuf$1519', no Bels remaining of type '$_TBUF_'
design.sv:2: ERROR [internal-tristate]: a tri-state driver (a z, at design.sv:2) on a signal that is not an inout pin of the top module: the chip has tri-state buffers on its pins only. Vivado converts such a driver to logic (UG901 Ch.5 Tristates); yosys keeps it as a $_TBUF_ cell, and nextpnr has nothing to place it on. Not a size problem. Fix: select with a mux instead:  assign bus = sel ? b : a;  and keep z for an inout pin only. https://nosey-dewdrop.github.io/dewfpga/errors/internal-tristate/
```

## Why does it happen?

`assign bus = sel ? a : 'z;` on an internal wire describes a shared bus; a 7-series chip has no internal tri-state, Vivado rewrites it as a mux (UG901 Ch.5 Tristates), yosys does not.

## What is the fix?

```copy
assign bus = sel ? b : a;
```

## tristate-to-logic
step: bit
source: dewfpga bit, yosys
title: design.sv:3 and design.sv:4: warning [tristate-to-logic]: bus has two tri-state drivers (a z, at design.sv:3 and design.sv:4) and is not an inout pin of the top module: the chip has tri-state buffers on its pins only, so yosys built the two drivers as logic, as Vivado does (UG901 Ch.5 Tristates). On the board bus is never z: with no driver on it shows one driver's value, with both on the other's, where the simulation shows z and x. Fix: select with a mux instead, so the simulation shows what the board does:  assign bus = sel ? b : a;  and keep z for an inout pin only.
summary: Two z drivers on one internal bus in one module; yosys builds them as logic, as Vivado does, so the board never shows the z or x the simulation shows.
date: 2026-09-27

A warning, not an error: the bitstream is built. yosys' own lines first (`multiple conflicting drivers`, one per bit, which reads like the two-always-blocks error); the CLI names the two lines with the `z` and what the board shows instead of z.

```
Warning: multiple conflicting drivers for top.\bus [0]:
    port Y[0] of cell $1 ($tribuf)
    port Y[0] of cell $0 ($tribuf)
design.sv:3 and design.sv:4: warning [tristate-to-logic]: bus has two tri-state drivers (a z, at design.sv:3 and design.sv:4) and is not an inout pin of the top module: the chip has tri-state buffers on its pins only, so yosys built the two drivers as logic, as Vivado does (UG901 Ch.5 Tristates). On the board bus is never z: with no driver on it shows one driver's value, with both on the other's, where the simulation shows z and x. Fix: select with a mux instead, so the simulation shows what the board does:  assign bus = sel ? b : a;  and keep z for an inout pin only. https://nosey-dewdrop.github.io/dewfpga/errors/tristate-to-logic/
```

## Why does it happen?

`assign bus = en_a ? a : 'z; assign bus = en_b ? b : 'z;` in one module describes a shared bus. A 7-series chip has tri-state buffers on its pins only, so Vivado rewrites the two drivers as logic (UG901 Ch.5 Tristates), and synth_xilinx does the same (`tribuf -logic`). The simulation shows z with no driver enabled and x with both; the board shows a value. (A z driver behind a submodule port is kept as a cell nextpnr cannot place: [internal-tristate](/dewfpga/errors/internal-tristate/).)

## What is the fix?

```copy
assign bus = sel ? b : a;
```

## wired-net
step: bit
source: dewfpga bit, nextpnr
title: design.sv:2: ERROR [wired-net]: a wor/wand net (declared at design.sv:2 and design.sv:3) with two drivers: yosys keeps the wired OR/AND as a $and cell, and nextpnr has nothing to place it on. Not a size problem. Fix: write the resolution yourself, in one assign:  assign any = sw[3:0] | sw[7:4];  (wand: &), and declare the net as logic.
summary: A wor or wand net with several drivers; yosys keeps the wired resolution as a $and/$or cell nextpnr cannot place.
date: 2026-09-27

```
ERROR: Unable to place cell '$auto$hierarchy.cc:1470:execute$1744', no Bels remaining of type '$and'
design.sv:2: ERROR [wired-net]: a wor/wand net (declared at design.sv:2 and design.sv:3) with two drivers: yosys keeps the wired OR/AND as a $and cell, and nextpnr has nothing to place it on. Not a size problem. Fix: write the resolution yourself, in one assign:  assign any = sw[3:0] | sw[7:4];  (wand: &), and declare the net as logic. https://nosey-dewdrop.github.io/dewfpga/errors/wired-net/
```

## Why does it happen?

Wired logic (`wor`, `wand`, `trior`, `triand`) resolves several drivers by OR or AND; yosys models that with a generic cell the Xilinx mapping does not know.

## What is the fix?

```copy
logic [3:0] any;
assign any = sw[3:0] | sw[7:4];
```

## power-operator
step: bit
source: dewfpga bit, nextpnr
title: design.sv:3: ERROR [power-operator]: ** with a base that is a signal (sw ** 2): yosys builds ** only for a constant base and exponent, or 2 ** n, and leaves this one as a $pow cell nextpnr has nothing to place on. Not a size problem. Fix: write the multiplication out (sw * sw), a table (case), or 1 << n for a power of two.
summary: The ** operator with a variable base; yosys builds only constant powers and 2 ** n.
date: 2026-09-27

```
ERROR: Unable to place cell '$pow$design.sv:3$1', no Bels remaining of type '$pow'
design.sv:3: ERROR [power-operator]: ** with a base that is a signal (sw ** 2): yosys builds ** only for a constant base and exponent, or 2 ** n, and leaves this one as a $pow cell nextpnr has nothing to place on. Not a size problem. Fix: write the multiplication out (sw * sw), a table (case), or 1 << n for a power of two. https://nosey-dewdrop.github.io/dewfpga/errors/power-operator/
```

## Why does it happen?

There is no general power circuit; Vivado builds `x ** 2` as a multiplier, yosys leaves the `$pow` cell unmapped.

## What is the fix?

```copy
assign led = sw * sw;
```

## empty-module
step: bit
source: dewfpga bit, nextpnr
title: design.sv:2: ERROR [empty-module]: the module blinker (design.sv:2), instantiated as u_blink, has no body (no assign, no always), so yosys kept it as a black box, and nextpnr has no cell of that type to place. Not a size problem. Fix: write the body of blinker, or comment the instance u_blink out until it is written.
summary: An instance of a module with ports and no body; yosys keeps it as a black box, nextpnr has no cell of that type.
date: 2026-09-27

```
ERROR: Unable to place cell 'u_blink', no Bels remaining of type 'blinker'
design.sv:2: ERROR [empty-module]: the module blinker (design.sv:2), instantiated as u_blink, has no body (no assign, no always), so yosys kept it as a black box, and nextpnr has no cell of that type to place. Not a size problem. Fix: write the body of blinker, or comment the instance u_blink out until it is written. https://nosey-dewdrop.github.io/dewfpga/errors/empty-module/
```

## Why does it happen?

A module skeleton written first, its body later: yosys treats a module with no logic as a black box (a cell to be supplied elsewhere), and place and route finds nothing to supply it.

## What is the fix?

Write the body, or comment the instance out until then.

```copy
// blinker u_blink(.clk(clk), .led(led[0]));
```

## design-too-big
step: bit
source: dewfpga bit, nextpnr
title: ERROR [design-too-big]: the design does not fit the XC7A35T (no SLICE_LUTX left: 20800 LUTs, 41600 FFs; a memory is built from LUTs as distributed RAM, unless (* ram_style = "block" *) asks for a block RAM). The counts are in top.log. Fix: make it smaller: fewer bits, a smaller memory, one divider or multiplier shared over several cycles.
summary: nextpnr ran out of a real resource of the chip; the counts are in the log.
date: 2026-09-27

```
ERROR: Unable to place cell '$abc$1234$auto$blifparse.cc:396:parse_blif$5678', no Bels remaining of type 'SLICE_LUTX'
ERROR [design-too-big]: the design does not fit the XC7A35T (no SLICE_LUTX left: 20800 LUTs, 41600 FFs; a memory is built from LUTs as distributed RAM, unless (* ram_style = "block" *) asks for a block RAM). The counts are in top.log. Fix: make it smaller: fewer bits, a smaller memory, one divider or multiplier shared over several cycles. https://nosey-dewdrop.github.io/dewfpga/errors/design-too-big/
```

## Why does it happen?

The Basys3's chip has 20800 LUTs and 41600 flip-flops. A large memory without `ram_style = "block"` is built from LUTs; a wide divider or multiplier in one cycle takes thousands. A cell type that is not a chip resource is one of [internal-tristate](/dewfpga/errors/internal-tristate/), [wired-net](/dewfpga/errors/wired-net/), [power-operator](/dewfpga/errors/power-operator/) or [empty-module](/dewfpga/errors/empty-module/), named as such.

## What is the fix?

`top.log` lists the counts per cell type. Ask for a block RAM, narrow the data, share the operator over cycles.

```copy
(* ram_style = "block" *) logic [7:0] mem [0:4095];
```

## timing-not-met
step: bit
source: dewfpga bit, nextpnr's timing report
title: ERROR [timing-not-met]: timing not met: clk 33.61 MHz (FAIL at 100.00 MHz). The longest path between two registers takes more than one period of that clock, so the design cannot run at it, and no bitstream is written; top.log has the critical path report (the registers and the logic between them). Fix: make the path shorter (a divide or a modulo in one cycle is the usual cause: register the intermediate results), or give it the time it needs: create_clock -period 30.000 [get_ports clk] (33.3 MHz) makes the check pass, and the Basys3 pin gives 100 MHz whatever the XDC says (its oscillator, Basys3 reference manual), so those registers must then take a new value only every 3 clocks or more (a clock enable from a counter: if (tick) ...).
summary: The longest path between two registers is longer than the clock period; the CLI writes no bitstream where Vivado would, with a critical warning.
date: 2026-09-27

The period the fix suggests is computed from the failing clock's number (33.61 MHz needs 29.8 ns, so 30.000), and it comes with what it costs: the Basys3 pin still gives 100 MHz. A clock made inside the design (a divider's output) is checked at 100 MHz too, and then the fix names it instead.

```
ERROR [timing-not-met]: timing not met: clk 33.61 MHz (FAIL at 100.00 MHz). The longest path between two registers takes more than one period of that clock, so the design cannot run at it, and no bitstream is written; top.log has the critical path report (the registers and the logic between them). Fix: make the path shorter (a divide or a modulo in one cycle is the usual cause: register the intermediate results), or give it the time it needs: create_clock -period 30.000 [get_ports clk] (33.3 MHz) makes the check pass, and the Basys3 pin gives 100 MHz whatever the XDC says (its oscillator, Basys3 reference manual), so those registers must then take a new value only every 3 clocks or more (a clock enable from a counter: if (tick) ...). https://nosey-dewdrop.github.io/dewfpga/errors/timing-not-met/
ERROR [timing-not-met]: timing not met: clk 498.01 MHz (PASS at 100.00 MHz), slow 35.39 MHz (FAIL at 100.00 MHz). The longest path between two registers takes more than one period of that clock, so the design cannot run at it, and no bitstream is written; top.log has the critical path report (the registers and the logic between them). Fix: make the path shorter (a divide or a modulo in one cycle is the usual cause: register the intermediate results); slow is a clock made inside the design and is checked at the same 100 MHz, so clock those registers on the port clock with a clock enable (if (tick) ...) instead of on slow. https://nosey-dewdrop.github.io/dewfpga/errors/timing-not-met/
```

## Why does it happen?

At 100 MHz a path has 10 ns; a 32-bit divide or modulo in one cycle takes 30. A design that fails timing may still seem to work on the board and fail at random, so the CLI stops instead of writing the bitstream (the recorded decision; Vivado writes it with a critical warning).

## What is the fix?

Register the intermediate results, or clock those registers on the port clock with an enable instead of on a derived clock:

```copy
always_ff @(posedge clk) if (tick) count <= count + 1;
```

## empty-fasm
step: bit
source: dewfpga bit, after place and route
title: ERROR [empty-fasm]: top.fasm has no FASM features (an empty or corrupt place-and-route output, usually a build interrupted half way). Fix: run  dewfpga clean  and build again.
summary: The place-and-route output file is empty, usually from a build interrupted between nextpnr and the bitstream.
date: 2026-09-27

```
ERROR [empty-fasm]: top.fasm has no FASM features (an empty or corrupt place-and-route output, usually a build interrupted half way). Fix: run  dewfpga clean  and build again. https://nosey-dewdrop.github.io/dewfpga/errors/empty-fasm/
```

## Why does it happen?

make rebuilds only what is older than its inputs; a `.fasm` left empty by a killed nextpnr looks up to date, and turning it into frames would fail.

## What is the fix?

```copy
dewfpga clean && dewfpga bit
```

## openfpgaloader-failed
step: flash
source: openFPGALoader, when you program the board
title: ERROR [openfpgaloader-failed]: openFPGALoader stopped with exit 1 (its message is above). Fix: read the lines above; a board that answers but refuses the bitstream usually needs the power switched off and on.
summary: The board was found, and programming still failed; openFPGALoader's own lines above say why.
date: 2026-09-27

```
ERROR [openfpgaloader-failed]: openFPGALoader stopped with exit 1 (its message is above). Fix: read the lines above; a board that answers but refuses the bitstream usually needs the power switched off and on. https://nosey-dewdrop.github.io/dewfpga/errors/openfpgaloader-failed/
```

## Why does it happen?

A JTAG chain that answers but does not accept the bitstream: a board left in a bad state, a cable that drops bits, a bitstream for another chip.

## What is the fix?

Power the board off and on, unplug and replug the cable, then:

```copy
dewfpga flash
```


## two-vivado-projects
step: project discovery
source: dewfpga, before choosing a project
title: ERROR [two-vivado-projects]
summary: More than one .xpr file is present, so the CLI cannot choose the intended project.
date: 2026-10-03

The diagnostic contains `two-vivado-projects`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

The project folder contains multiple Vivado project files. Choosing one silently could build a different design.

## What is the fix?

Keep each project in its own directory. Alternatively, copy the required source and constraint files to a flat directory outside the Vivado project tree, then run dewfpga there.

```copy
dewfpga tops
```


## vivado-file-missing
step: project discovery
source: the Vivado project file list
title: NEW.xpr:11: ERROR [vivado-file-missing]: NEW.xpr lists $PPRDIR/../archive/counter2.sv (../archive/counter2.sv), and that file is not there.
summary: An enabled source or constraint entry names a file that is absent from this checkout.
date: 2026-10-03

The diagnostic contains `vivado-file-missing`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

The .xpr is authoritative. A file copied from another machine, omitted from Git, moved, or deleted can still be listed by the project.

## What is the fix?

Restore the named file, or remove its entry through Vivado and save the project. To use a flat layout instead, copy the files to a directory outside the project tree; running inside .srcs still discovers the parent project.

```copy
dewfpga tops
```


## vivado-project-unreadable
step: project discovery
source: the Vivado XML reader
title: NEW.xpr:1: ERROR [vivado-project-unreadable]
summary: The project file is not parseable Vivado XML.
date: 2026-10-03

The diagnostic contains `vivado-project-unreadable`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

A truncated or manually edited .xpr cannot supply a reliable source list. The CLI stops instead of guessing from nearby files.

## What is the fix?

Open and save a valid project in Vivado, or restore the .xpr from its backup. A flat copy must be outside the original project tree.

```copy
dewfpga tops
```


## vivado-path-unknown
step: project discovery
source: the Vivado source path reader
title: MIX.xpr:1: ERROR [vivado-path-unknown]
summary: A listed path uses a Vivado variable that this CLI cannot resolve.
date: 2026-10-03

The diagnostic contains `vivado-path-unknown`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

The reader resolves $PSRCDIR and $PPRDIR. A cache or generated-IP variable can refer to a Vivado-specific directory whose contents are not available to this toolchain.

## What is the fix?

Copy the required source into the project source directory and add that file through Vivado, then save. Generated IP and block designs are not automatically converted into supported RTL.

```copy
dewfpga tops
```


## vivado-set-ambiguous
step: project discovery
source: the active Vivado file-set selection
title: MIX.xpr:1: ERROR [vivado-set-ambiguous]
summary: The project does not identify which of several source, constraint or simulation sets to use.
date: 2026-10-03

The diagnostic contains `vivado-set-ambiguous`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

The reader follows synth_1 source/constraint selection and ActiveSimSet. It refuses a missing or inconsistent selection when multiple sets exist. An ambiguous simulation set stops simulation; it does not choose a random testbench.

## What is the fix?

Select the intended active set in Vivado and save the project. Re-run the command for that project; a flat copy outside the project tree is the explicit alternative.

```copy
dewfpga sim
```


## vscode-tasks-unreadable
step: vscode
source: the user-task configuration reader
title: tasks.json:1: ERROR [vscode-tasks-unreadable]
summary: The task document or its ownership record cannot be interpreted safely.
date: 2026-10-03

The diagnostic contains `vscode-tasks-unreadable`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

The writer accepts JSON with comments and trailing commas. Malformed JSON, duplicate object keys, an unsupported ownership-record schema or a non-regular file is refused. Existing user content is preserved.

## What is the fix?

Inspect the named file and restore a known-good backup if necessary. Do not delete the ownership record to force adoption: without it, the writer cannot prove that matching tasks belong to it. The print command shows the configuration for a manual merge.

```copy
dewfpga vscode --print
```


## vscode-tasks-conflict
step: vscode
source: the user-task ownership check
title: tasks.json:1: ERROR [vscode-tasks-conflict]
summary: An existing task label or input id collides with the proposed configuration without verified ownership.
date: 2026-10-03

The diagnostic contains `vscode-tasks-conflict`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

A matching label or command is not proof that dewfpga created the entry. The writer refuses to overwrite or adopt the user's task, even when the command text is identical.

## What is the fix?

Keep the user task. Rename the colliding label or input in VS Code if appropriate, or merge the printed configuration manually with distinct names. Preserve the ownership file for entries installed by dewfpga.

```copy
dewfpga vscode --print
```


## vscode-tasks-write-failed
step: vscode
source: the user-task file writer
title: tasks.json:1: ERROR [vscode-tasks-write-failed]
summary: Writing or replacing the task document or ownership record failed.
date: 2026-10-03

The diagnostic contains `vscode-tasks-write-failed`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

Permissions, unavailable storage or a filesystem error can block the update. Both new files are prepared first; if committing the ownership file fails, the previous task document is restored. If restoration itself is blocked, the diagnostic names the retained recovery copy.

## What is the fix?

Read the complete diagnostic before retrying. Keep the backup or recovery copy, fix the reported filesystem problem and then run setup again. Do not assume a failed update completed.

```copy
dewfpga vscode
```


## vscode-not-found
step: vscode
source: the optional editor setup
title: note [vscode-not-found]
summary: The VS Code command is unavailable; the FPGA command-line toolchain can still be used.
date: 2026-10-03

The diagnostic contains `vscode-not-found`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

Editor integration is optional. The setup looks for an editor CLI on PATH or in supported macOS application bundles.

## What is the fix?

Open the installed editor and enable its shell command, then retry setup. A missing editor does not require reinstalling the FPGA toolchain.

```copy
dewfpga vscode
```


## vscode-extension-install-failed
step: vscode
source: the companion extension installer
title: ERROR [vscode-extension-install-failed]
summary: The companion extension could not be built, installed or verified.
date: 2026-10-03

The diagnostic contains `vscode-extension-install-failed`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

User tasks require the companion's top-selection command. Setup does not write those tasks after a failed companion installation. The optional Verilog language extension can also be unavailable when the marketplace cannot be reached; the diagnostic distinguishes that case.

## What is the fix?

Read the command failure, verify the selected editor can install extensions and retry. The plain FPGA CLI remains usable. Keep existing user tasks while resolving the extension problem.

```copy
dewfpga vscode
```


## vscode-linter-shim-retained
step: vscode removal
source: the companion extension ownership check
title: note [vscode-linter-shim-retained]
summary: The companion is retained because a settings value still points to its linter shim, or settings cannot be checked safely.
date: 2026-10-03

The diagnostic contains `vscode-linter-shim-retained`. File paths, line numbers and the detailed reason depend on the project or editor configuration; read the complete line printed by the command.

## Why does it happen?

Deleting the extension while verilog.linting.path points inside it would break linting. The task remover does not overwrite user settings to force removal.

## What is the fix?

In VS Code run “dewfpga: stop using the dewfpga iverilog lint shim”. That command restores only the value the extension owns. Then retry removal. If the setting was entered manually, review it manually rather than deleting unrelated settings.

```copy
dewfpga vscode --remove
```

## cannot-write-here
step: sim / synth
source: private Verilog-2005 source wrappers
title: dewfpga could not create its temporary work folder
summary: The build directory is not writable, or the disk has no space for the temporary source copies.
date: 2026-10-03

`ERROR [cannot-write-here]: cannot create a work folder ...`

## Why does it happen?

The compiler needs a privately reserved directory for Verilog-2005 source copies. Creating it failed before compilation began.

## What is the fix?

Check the project folder's permissions with `ls -ld .` and available disk space with `df -h .`. Use a writable project folder or free space, then retry. Do not delete another running build's temporary directory.

## command-timeout
step: agent CLI
source: JSON command deadline
title: The command exceeded its time limit
summary: The JSON wrapper stopped a command that did not finish within its deadline.
date: 2026-10-03

`ERROR [command-timeout]` appears as a JSON diagnostic with exit 124.

## Why does it happen?

The command took longer than the selected timeout. A stalled simulation, slow build or disconnected programmer can require investigation.

## What is the fix?

Read `log.tail` and `log.path`. Fix an unbounded testbench or tool problem first. If the command is making progress, retry with a larger limit, for example `dewfpga bit --json --timeout=1200`.

## internal
step: agent CLI
source: JSON output capture
title: The wrapper could not produce a complete command result
summary: Starting the command, reading its output or another wrapper operation failed.
date: 2026-10-03

The JSON result contains `code: "internal"`. Exit 70 reports a wrapper failure; interrupted calls use exit 130 or 143.

## Why does it happen?

A child could not start, an output reader failed, or a descendant kept output open after the command exited. These cases cannot be treated as successful results. A parent signal can also interrupt the command.

## What is the fix?

Read the diagnostic and temporary log. Verify the installed CLI files and filesystem access, then retry. Preserve the diagnostic and command when reporting a reproducible wrapper error. Do not use a leftover bitstream as proof that the interrupted command succeeded.

## mcp-not-installed
step: agent interface
source: optional MCP SDK
title: The optional MCP server is not installed
summary: The isolated MCP Python environment is missing or cannot import the required SDK.
date: 2026-10-03

`ERROR [mcp-not-installed]` stops `dewfpga mcp` with exit 3. The ordinary CLI does not require this SDK.

## Why does it happen?

The optional SDK step was skipped or failed, or its environment was removed. The client must launch dewfpga's MCP environment rather than an unrelated Python interpreter.

## What is the fix?

Run `dewfpga install` without `DEWFPGA_SKIP_MCP=1` and inspect the SDK step's output. Then retry the client connection to `dewfpga mcp`. Do not install the MCP package into your system Python as a workaround.
