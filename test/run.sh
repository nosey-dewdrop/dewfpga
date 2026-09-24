#!/usr/bin/env bash
# dewfpga test suite. Needs an installed toolchain (FPGA_HOME, default ~/fpga).
#   test/run.sh            everything except the clean install
#   FULL=1 test/run.sh     also a clean install into a temp FPGA_HOME (~4 min, 1.4 GB)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/bin/dewfpga"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
check(){ if eval "$2" >"$T/out" 2>&1; then ok "$1"; else bad "$1"; sed 's/^/       /' "$T/out" | head -5; fi; }
# golden .fasm minus the tool-version comment line (differs between tag/sha checkouts)
strip() { grep -v '^# nextpnr' "$1" | sort; }

echo "== static"
check "shellcheck"            "shellcheck -S style '$ROOT/install.sh' '$CLI' '$ROOT/test/run.sh'"
check "bash -n"               "bash -n '$ROOT/install.sh' && bash -n '$CLI'"
check "no personal paths"     "! grep -rn '/Users/' --exclude-dir=.git --exclude-dir=.rabadon --exclude-dir=node_modules --exclude=run.sh --exclude=.fpga_home '$ROOT' | grep -v '/Users/you/' | grep -q ."
check "no sudo/eval/curl|sh"  "! grep -nE 'sudo |eval |curl.*\| *(ba)?sh' '$ROOT/install.sh' '$CLI'"
check "https only"            "! grep -n 'http://' '$ROOT/install.sh'"
check "--version"             "v=\$('$CLI' --version); [ -n \"\$v\" ] && [ \"\$v\" = \"\$(sed -n 's/.*\"version\": *\"\([^\"]*\)\".*/\1/p' '$ROOT/package.json')\" ]"

echo "== toolchain"
check "check passes"          "'$CLI' check"

echo "== build (folder with only .sv + .xdc)"
mkdir -p "$T/w"; cp "$ROOT"/templates/{blink.sv,blink.xdc,blink_tb.sv} "$T/w/"
check "sim"                   "cd '$T/w' && '$CLI' sim | grep -q '^PASS: 3 checks'"
check "bit"                   "cd '$T/w' && '$CLI' bit && [ -s blink.bit ]"
# The golden .fasm is exact only for the yosys version it was made with (brew can't be pinned).
# With another yosys the netlist differs, so only the I/O placement (IOB lines = XDC pins) is compared.
YV=$(yosys -V | awk '{print $2}'); GV=$(cat "$ROOT/test/golden/yosys-version")
if [ "$YV" = "$GV" ]; then
    check "fasm == golden (yosys $YV)" "diff <(strip '$T/w/blink.fasm') <(strip '$ROOT/test/golden/blink.fasm')"
else
    echo "  SKIP fasm == golden: yosys $YV here, golden made with $GV; checking I/O placement only"
    check "fasm I/O placement == golden" "diff <(grep -E '^[LR]IOB33' '$T/w/blink.fasm' | sort) <(grep -E '^[LR]IOB33' '$ROOT/test/golden/blink.fasm' | sort)"
fi
check "no warnings in output" "cd '$T/w' && '$CLI' clean && ! '$CLI' bit 2>&1 | grep -qiE 'warning|error'"
check "bit is deterministic"  "cd '$T/w' && cp blink.frames a && '$CLI' clean && '$CLI' bit >/dev/null && cmp a blink.frames"
# programming a board that happens to be plugged in is not something a test suite should do unless asked
if [ "${DEWFPGA_TEST_BOARD:-}" = 1 ] || ! system_profiler SPUSBDataType 2>/dev/null | grep -q 'Digilent'; then
check "flash w/o board: message" "cd '$T/w' && { '$CLI' flash || true; } 2>&1 | grep -qE 'board not found|done'"
else echo "  SKIP flash: a Digilent board is plugged in; DEWFPGA_TEST_BOARD=1 to program it"; fi
check "flash w/o board: no make trailer" "cd '$T/w' && ! { '$CLI' flash || true; } 2>&1 | grep -q 'make: \*\*\*'"
check "bit output is short (<=3 lines)" "cd '$T/w' && '$CLI' clean && [ \$('$CLI' bit 2>&1 | wc -l) -le 3 ]"
check "bit prints xdc, pnr, bit lines" "cd '$T/w' && '$CLI' clean && out=\$('$CLI' bit 2>&1) && grep -q '^xdc ok' <<<\"\$out\" && grep -q '^pnr ok.*PASS' <<<\"\$out\" && grep -q '^blink.bit' <<<\"\$out\""
check "bit up to date: exit 0, one line" "cd '$T/w' && out=\$('$CLI' bit 2>&1) && [ \"\$out\" = 'blink.bit is up to date (nothing changed since the last build; dewfpga clean forces a rebuild)' ]"
check "full pnr log kept"       "cd '$T/w' && grep -q 'Max frequency' blink.log"

echo "== multi-file design"
mkdir -p "$T/m"; cd "$T/m"
printf 'module counter #(parameter int HALF=50_000_000)(input logic clk, output logic tick);\n logic [25:0] c=0; always_ff @(posedge clk) if (c==HALF-1) begin c<=0; tick<=~tick; end else c<=c+1;\nendmodule\n' > counter.sv
printf "module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n logic t; counter u(.clk(clk),.tick(t)); assign led={sw[0],14'b0,t&sw[0]};\nendmodule\n" > top.sv
sed 's/blink/top/' "$ROOT/templates/blink.xdc" > top.xdc
check "top found from the hierarchy (submodule in its own file)" "cd '$T/m' && '$CLI' bit && [ -s top.bit ]"
check "lab layout: lab4.sv + Basys3_Master.xdc" "mkdir -p '$T/lab' && sed 's/module blink/module lab4/' '$ROOT/templates/blink.sv' > '$T/lab/lab4.sv' && cp '$ROOT/templates/blink.xdc' '$T/lab/Basys3_Master.xdc' && cd '$T/lab' && '$CLI' bit >out 2>&1 && [ -s lab4.bit ] && grep -q '^xdc ok' out"
check "no xdc -> says what to copy" "mkdir -p '$T/nox' && cp '$ROOT/templates/blink.sv' '$T/nox/' && cd '$T/nox' && ! '$CLI' bit >out 2>&1 && grep -q 'Basys3_Master.xdc' out"
check "no xdc: top still found from the hierarchy, then a clear pin-file error" "cd '$T/m' && rm top.xdc && { '$CLI' bit || true; } 2>&1 | grep -q 'no .xdc pin file' && ! '$CLI' bit 2>/dev/null"
check "two roots, nothing decides -> error names both" "mkdir -p '$T/two' && cp '$ROOT/templates/blink.sv' '$T/two/a.sv' && sed 's/module blink/module other/' '$ROOT/templates/blink.sv' > '$T/two/b.sv' && cp '$ROOT/templates/blink.xdc' '$T/two/pins.xdc' && cd '$T/two' && ! '$CLI' bit >out 2>&1 && grep -q 'could be the top' out && grep -q 'blink' out && grep -q 'other' out"
check "testbench found by content, not by name" "mkdir -p '$T/tbn' && cp '$ROOT/templates/blink.sv' '$ROOT/templates/blink.xdc' '$T/tbn/' && cp '$ROOT/templates/blink_tb.sv' '$T/tbn/testbench.sv' && cd '$T/tbn' && '$CLI' sim >out 2>&1 && grep -q '^PASS: 3 checks' out && '$CLI' bit >out2 2>&1 && [ -s blink.bit ]"

echo "== error paths"
check "new: existing dir"     "{ '$CLI' new '$T/w' || true; } 2>&1 | grep -q 'already exists' && ! '$CLI' new '$T/w' 2>/dev/null"
check "unknown command"       "! '$CLI' nope 2>/dev/null"
check "check w/ empty home"   "! FPGA_HOME='$T/none' '$CLI' check >/dev/null"
check "bit w/o toolchain"     "cd '$T/w' && { FPGA_HOME='$T/none' '$CLI' bit || true; } 2>&1 | grep -q 'not installed'"
check "sim w/o testbench"     "cd '$T/m' && { '$CLI' sim top || true; } 2>&1 | grep -q 'testbench'"
check "failing testbench -> exit 1" "mkdir -p '$T/ft' && sed 's/assign led = .*/assign led = 16'\\''hFFFF;/' '$ROOT/templates/blink.sv' > '$T/ft/blink.sv' && cp '$ROOT/templates/blink_tb.sv' '$T/ft/' && cd '$T/ft' && ! '$CLI' sim >out 2>&1 && grep -q '^FAIL: 2 of 3' out && grep -q 'reported errors' out"
check "timing not met -> error, no bit" "mkdir -p '$T/tm' && cp '$ROOT/templates/blink.sv' '$T/tm/' && sed 's/-period 10.00/-period 0.50/; s/-waveform {0 5}/-waveform {0 0.25}/' '$ROOT/templates/blink.xdc' > '$T/tm/blink.xdc' && cd '$T/tm' && ! '$CLI' bit >out 2>&1 && grep -q 'timing not met' out && [ ! -e blink.bit ] && [ ! -e blink.fasm ]"
check "file name with a space -> clear error" "mkdir -p '$T/spc' && cp '$ROOT/templates/blink.sv' '$T/spc/my blink.sv' && cp '$ROOT/templates/blink.xdc' '$T/spc/my blink.xdc' && cd '$T/spc' && ! '$CLI' bit >out 2>&1 && grep -q 'spaces are not supported' out"
check "unused xdc pins are ignored" "mkdir -p '$T/xa' && cp '$ROOT/templates/blink.sv' '$T/xa/' && sed 's/^#set_property/set_property/' '$ROOT/templates/Basys3_Master.xdc' > '$T/xa/blink.xdc' && cd '$T/xa' && '$CLI' bit >out 2>&1 && grep -q 'unused pins in the XDC ignored' out && [ -s blink.bit ]"
check "bit blink.sv works like bit blink" "cd '$T/w' && '$CLI' bit blink.sv"
check "help has no comment marks" "! '$CLI' --help | grep -q '^#'"
check "no create_clock -> checked at 100 MHz" "mkdir -p '$T/nc' && cp '$ROOT/templates/blink.sv' '$T/nc/' && grep -v create_clock '$ROOT/templates/blink.xdc' > '$T/nc/blink.xdc' && cd '$T/nc' && '$CLI' bit >out 2>&1 && grep -q 'PASS at 100.00 MHz' out && grep -q 'no create_clock' out"
check ".v file with SystemVerilog inside builds" "mkdir -p '$T/vv' && cp '$ROOT/templates/blink.sv' '$T/vv/blink.v' && cp '$ROOT/templates/blink.xdc' '$T/vv/' && cd '$T/vv' && '$CLI' bit >out 2>&1 && [ -s blink.bit ]"
check "module name != file name -> builds, output named after the module" "mkdir -p '$T/mn' && sed 's/module blink/module top/' '$ROOT/templates/blink.sv' > '$T/mn/lab4.sv' && cp '$ROOT/templates/blink.xdc' '$T/mn/lab4.xdc' && cd '$T/mn' && '$CLI' bit >out 2>&1 && [ -s top.bit ]"
check "course SevSeg port line fixed in place, build goes through" "mkdir -p '$T/ss' && printf 'module ss(input clk, output [6:0]seg, logic dp, output [3:0] an);\\n assign seg = 7'\\''h55; assign dp = 1; assign an = 4'\\''b1110;\\nendmodule\\n' > '$T/ss/ss.sv' && grep -E 'seg|an\\[|dp|clk' '$ROOT/templates/Basys3_Master.xdc' | sed 's/^#//' > '$T/ss/ss.xdc' && cd '$T/ss' && '$CLI' bit >out 2>&1 && grep -q 'wrote the port direction' out && grep -q 'output logic dp' ss.sv && [ -s ss.bit ]"
check "vivado funcsim netlist -> named, not fed to yosys" "mkdir -p '$T/nl' && cp '$ROOT/templates/blink.sv' '$ROOT/templates/blink.xdc' '$T/nl/' && printf '// Tool Version: Vivado v.2021.2\\n// Purpose : This verilog netlist is a functional simulation representation of the design\\n(* NotValidForBitStream *)\\nmodule leftover(input a, output b); assign b = a; endmodule\\n' > '$T/nl/leftover_func_impl.v' && cd '$T/nl' && ! '$CLI' bit >out 2>&1 && grep -q 'netlist Vivado wrote after synthesis' out"
check "unnamed instance -> line and fix" "mkdir -p '$T/ui' && printf 'module sub(input a, output b); assign b = a; endmodule\\nmodule ui(input logic [1:0] sw, output logic [1:0] led);\\n sub(sw[0], led[0]);\\n assign led[1] = sw[1];\\nendmodule\\n' > '$T/ui/ui.sv' && cp '$ROOT/templates/blink.xdc' '$T/ui/ui.xdc' && cd '$T/ui' && ! '$CLI' bit >out 2>&1 && grep -q 'ui.sv:3: .sub(. is an instance without a name' out"
check "uninstall refuses FPGA_HOME=HOME" "! FPGA_HOME=\"\$HOME\" '$CLI' uninstall >out 2>&1 && grep -q 'refusing' out && [ -d \"\$HOME/fpga\" ]"
check "corrupt .fasm -> error, no .frames" "cd '$T/w' && '$CLI' clean && '$CLI' bit >/dev/null && sleep 1.1 && echo garbage > blink.fasm && ! '$CLI' bit >out 2>&1 && grep -q 'no FASM features' out"
check "port missing in xdc"   "cd '$T/w' && sed '/led\[15\]/d' blink.xdc > bad.xdc && cp blink.sv b.sv && mkdir x && mv b.sv x/blink.sv && cp bad.xdc x/blink.xdc && cd x && { '$CLI' bit || true; } 2>&1 | grep -q 'led\[15\]'"
check "install: refuses sudo" "mkdir -p '$T/fb' && printf '#!/bin/sh\n[ \"\$1\" = -u ] && echo 0 || /usr/bin/id \"\$@\"\n' > '$T/fb/id' && chmod +x '$T/fb/id' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'sudo'"
check "install: refuses x86"  "rm -f '$T/fb/id'; printf '#!/bin/sh\n[ \"\$1\" = -m ] && echo x86_64 || /usr/bin/uname \"\$@\"\n' > '$T/fb/uname' && chmod +x '$T/fb/uname' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'arm64'"
check "install: no network -> clear error" "rm -rf '$T/e'; { GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=http://127.0.0.1:9 FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'could not fetch'"
check "install: idempotent (<10 s)" "s=\$(date +%s); '$ROOT/install.sh' >/dev/null 2>&1; [ \$(( \$(date +%s) - s )) -lt 10 ]"

echo "== project template"
check "new + dewfpga bit"     "'$CLI' new '$T/p' && cd '$T/p' && '$CLI' bit && [ -s blink.bit ]"
check "new: no Makefile, task uses dewfpga" "cd '$T/p' && [ ! -e Makefile ] && grep -q '\"dewfpga flash\"' .vscode/tasks.json && ! grep -q 'make ' .vscode/tasks.json && python3 -c 'import json;json.load(open(\".vscode/settings.json\"));json.load(open(\".vscode/extensions.json\"))'"
check "manual path: templates/Makefile"  "mkdir '$T/mk' && cp '$ROOT'/templates/{blink.sv,blink_tb.sv,blink.xdc,check_xdc.py,Makefile} '$T/mk/' && cd '$T/mk' && make -s bit > out.txt && grep -q '^pnr ok' out.txt && [ -s blink.bit ] && ! make check | grep -q MISSING"

if [ "${FULL:-}" = 1 ]; then
    echo "== clean install into temp FPGA_HOME"
    check "clean install exit 0" "FPGA_HOME='$T/fresh' '$ROOT/install.sh'"
    check "fresh chain builds golden" "mkdir '$T/fw' && cp '$ROOT'/templates/{blink.sv,blink.xdc} '$T/fw/' && cd '$T/fw' && FPGA_HOME='$T/fresh' '$CLI' bit && diff <(strip blink.fasm) <(strip '$ROOT/test/golden/blink.fasm')"
fi

echo; echo "passed $pass, failed $fail"
[ $fail -eq 0 ]
