#!/usr/bin/env bash
# mac-fpga test suite. Needs an installed toolchain (FPGA_HOME, default ~/fpga).
#   test/run.sh            everything except the clean install
#   FULL=1 test/run.sh     also a clean install into a temp FPGA_HOME (~4 min, 1.4 GB)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/bin/mac-fpga"
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
check "no personal paths"     "! grep -rn '/Users/' --exclude-dir=.git --exclude-dir=.rabadon --exclude-dir=node_modules --exclude=run.sh '$ROOT'"
check "no sudo/eval/curl|sh"  "! grep -nE 'sudo |eval |curl.*\| *(ba)?sh' '$ROOT/install.sh' '$CLI'"
check "https only"            "! grep -n 'http://' '$ROOT/install.sh'"
check "--version"             "[ \"\$('$CLI' --version)\" = \"\$(sed -n 's/.*\"version\": *\"\([^\"]*\)\".*/\1/p' '$ROOT/package.json')\" ]"

echo "== toolchain"
check "check passes"          "'$CLI' check"

echo "== build (folder with only .sv + .xdc)"
mkdir -p "$T/w"; cp "$ROOT"/templates/{blink.sv,blink.xdc,blink_tb.sv} "$T/w/"
check "sim"                   "cd '$T/w' && '$CLI' sim | grep -q 'basic checks passed'"
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
check "flash w/o board: message" "cd '$T/w' && { '$CLI' flash || true; } 2>&1 | grep -qE 'board not found|done'"

echo "== multi-file design"
mkdir -p "$T/m"; cd "$T/m"
printf 'module counter #(parameter int HALF=50_000_000)(input logic clk, output logic tick);\n logic [25:0] c=0; always_ff @(posedge clk) if (c==HALF-1) begin c<=0; tick<=~tick; end else c<=c+1;\nendmodule\n' > counter.sv
printf "module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n logic t; counter u(.clk(clk),.tick(t)); assign led={sw[0],14'b0,t&sw[0]};\nendmodule\n" > top.sv
sed 's/blink/top/' "$ROOT/templates/blink.xdc" > top.xdc
check "top found from xdc"    "cd '$T/m' && '$CLI' bit && [ -s top.bit ]"
check "ambiguous top -> error" "cd '$T/m' && rm top.xdc && { '$CLI' bit || true; } 2>&1 | grep -q 'cannot tell' && ! '$CLI' bit 2>/dev/null"

echo "== error paths"
check "new: existing dir"     "{ '$CLI' new '$T/w' || true; } 2>&1 | grep -q 'already exists' && ! '$CLI' new '$T/w' 2>/dev/null"
check "unknown command"       "! '$CLI' nope 2>/dev/null"
check "check w/ empty home"   "! FPGA_HOME='$T/none' '$CLI' check >/dev/null"
check "bit w/o toolchain"     "cd '$T/w' && { FPGA_HOME='$T/none' '$CLI' bit || true; } 2>&1 | grep -q 'not installed'"
check "sim w/o testbench"     "cd '$T/m' && { '$CLI' sim top || true; } 2>&1 | grep -q 'testbench'"
check "port missing in xdc"   "cd '$T/w' && sed '/led\[15\]/d' blink.xdc > bad.xdc && cp blink.sv b.sv && mkdir x && mv b.sv x/blink.sv && cp bad.xdc x/blink.xdc && cd x && { '$CLI' bit || true; } 2>&1 | grep -q 'led\[15\]'"
check "install: refuses sudo" "mkdir -p '$T/fb' && printf '#!/bin/sh\n[ \"\$1\" = -u ] && echo 0 || /usr/bin/id \"\$@\"\n' > '$T/fb/id' && chmod +x '$T/fb/id' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'sudo'"
check "install: refuses x86"  "rm -f '$T/fb/id'; printf '#!/bin/sh\n[ \"\$1\" = -m ] && echo x86_64 || /usr/bin/uname \"\$@\"\n' > '$T/fb/uname' && chmod +x '$T/fb/uname' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'arm64'"
check "install: no network -> clear error" "rm -rf '$T/e'; { GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=http://127.0.0.1:9 FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'could not fetch'"
check "install: idempotent (<10 s)" "s=\$(date +%s); '$ROOT/install.sh' >/dev/null 2>&1; [ \$(( \$(date +%s) - s )) -lt 10 ]"

echo "== project template"
check "new + make bit"        "'$CLI' new '$T/p' && cd '$T/p' && make bit && [ -s blink.bit ]"
check "new + make check"      "cd '$T/p' && ! make check | grep -q MISSING"

if [ "${FULL:-}" = 1 ]; then
    echo "== clean install into temp FPGA_HOME"
    check "clean install exit 0" "FPGA_HOME='$T/fresh' '$ROOT/install.sh'"
    check "fresh chain builds golden" "mkdir '$T/fw' && cp '$ROOT'/templates/{blink.sv,blink.xdc} '$T/fw/' && cd '$T/fw' && FPGA_HOME='$T/fresh' '$CLI' bit && diff <(strip blink.fasm) <(strip '$ROOT/test/golden/blink.fasm')"
fi

echo; echo "passed $pass, failed $fail"
[ $fail -eq 0 ]
