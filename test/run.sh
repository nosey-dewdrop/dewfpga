#!/usr/bin/env bash
# dewfpga test suite. Needs an installed toolchain (FPGA_HOME, default ~/fpga).
#   test/run.sh            everything except the clean install, including the SystemVerilog probes in test/sv
#   test/run.sh --list     the name of every check, the probes as one line 'N probes', and a last line 'N checks'
#                          (N counts the probes too, as 'passed N' does); README, README.tr and site/cli quote that N.
#                          N is the same on every machine and in every mode: the board and the clean-install checks
#                          are listed whether or not they run here, so a run may print fewer PASS lines than N, never more
#   ONLY=regex test/run.sh only the checks whose name matches (the probes are skipped). The '== build' and
#                          '== multi-file design' checks use the folder the section's first check built, so name that
#                          one in the regex too ('bit|deterministic'); the bitstream and board checks build what they need
#   FULL=1 test/run.sh     also a clean install into a temp FPGA_HOME (~4 min, 1.4 GB)
#   SV_OUT=file            keep the probes' result rows (test/sv/run.sh writes them)
# A probe that does what test/sv/expect.tsv records but fails a stage Vivado passes, or builds a bitstream
# whose netlist fails, is a known GAP: printed and counted on its own, not as a pass, and it does not fail the
# run. A probe that fails a stage where Vivado refuses the code, or where what Vivado does is unverified, is a
# PASS, unless its bitstream builds from a netlist that fails: that silent wrong is a GAP whatever Vivado does.
# Each probe's verdict is worked out here again from expect.tsv and its four stages, and has to agree with
# test/sv/run.sh's, whose exit code has to agree with its rows.
set -euo pipefail
# Installer/uninstaller coverage must not modify the developer's real editor profile.
# The separate VS Code setup tests fence their own editor executable and scratch HOME.
export DEWFPGA_SKIP_VSCODE=1
# Installer fixtures must not download the optional SDK; MCP tests use their own environments.
export DEWFPGA_SKIP_MCP=1
LIST=0; case ${1:-} in --list) LIST=1 ;; "") ;; *) echo "usage: test/run.sh [--list]   (ONLY=regex, FULL=1, SV_OUT=file in the environment)" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/bin/dewfpga"
# the checks below cd around, so a relative SV_OUT is made absolute here, against the caller's folder
case ${SV_OUT:-} in ""|/*) ;; *) SV_OUT="$PWD/$SV_OUT" ;; esac
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0; gaps=0; listed=0
sec()  { [ "$LIST" = 1 ] || echo "$1"; }
ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
gap()  { gaps=$((gaps+1)); printf '  \033[33mGAP\033[0m  %s\n' "$1"; }
check(){ if [ "$LIST" = 1 ]; then listed=$((listed+1)); echo "$1"; return; fi; [ -z "${ONLY:-}" ] || grep -qE -- "$ONLY" <<< "$1" || return 0
         if eval "$2" >"$T/out" 2>&1; then ok "$1"; else bad "$1"; shown "$T/out"; fi; }
# under a FAIL: the first 5 lines of the check's output, then any ERROR line past them (the product prints its
# ERROR line last, after the tool's own lines, so a long openFPGALoader message must not hide it)
shown() { sed 's/^/       /' "$1" | head -5; tail -n +6 "$1" | grep 'ERROR \[' | sed 's/^/       /' || true; }
# say <cmd...>: runs the command with its output kept in $T/say, for the check's grep, and printed too, so the
# lines the product wrote show under a FAIL. A check that pipes the product into grep -q, or writes to its own
# file, leaves the FAIL bare (nothing a student can act on). Returns the command's exit code
say() { local rc=0; "$@" > "$T/say" 2>&1 || rc=$?; cat "$T/say"; return $rc; }
# golden .fasm minus the tool-version comment line (differs between tag/sha checkouts)
strip() { grep -v '^# nextpnr' "$1" | sort; }

sec "== static"
check "shellcheck"            "shellcheck -S style --enable=check-unassigned-uppercase '$ROOT/install.sh' && shellcheck -S style '$ROOT/install.sh' '$CLI' '$ROOT/test/run.sh' '$ROOT/test/sv/run.sh' '$ROOT/test/sv/eqv.sh' '$ROOT/test/sv/eqv_check.sh' '$ROOT/test/bit-check.sh' '$ROOT/site/install' '$ROOT/deploy.sh' '$ROOT/vscode/bin/iverilog' '$ROOT/test/vivado/run.sh' '$ROOT/test/agent/experiment/acceptance.sh' '$ROOT/test/agent/experiment/self-test.sh'"
check "bash -n"               "bash -n '$ROOT/install.sh' && bash -n '$CLI'"
# every file is scanned, this one too: a home folder is /Users/ and a name (/Users/you/ is the guide's placeholder).
# This file writes the pattern with no name after /Users/, and its planted paths through printf's %s
personal_paths() { grep -rnoE '/Users/[A-Za-z0-9._-]+/?' --exclude-dir=.git --exclude=.git --exclude-dir=.rabadon --exclude-dir=.claude --exclude-dir=node_modules --exclude=.fpga_home "$1" | grep -vE ':/Users/you/?$'; }
check "no personal paths"     "! personal_paths '$ROOT' | grep -q ."
check "personal-path check sees test/sv/run.sh" "mkdir -p '$T/pp/test/sv' && printf '# /Users/%s/fpga\\n' someone > '$T/pp/test/sv/run.sh' && personal_paths '$T/pp' | grep -q 'test/sv/run.sh'"
check "personal-path check sees test/run.sh" "printf '# built on /Users/%s/fpga\\n' someone > '$T/pp/test/run.sh' && personal_paths '$T/pp' | grep -q 'test/run.sh:1:'"
# expect.tsv's vivado_source column quotes Vivado logs from public student repos: the quotes keep the log
# line, not the student's names ('<its top>' instead of the name, and no Vivado '(name_reg)' either)
student_names() { awk -F'\t' '{print NR": "$4}' "$1" | grep -E "(module|design|variable|signal|instance|cell|port|net|register|clock) [\`']\\\\?[A-Za-z_]|\\([A-Za-z_][A-Za-z0-9_]*_reg(\\[[0-9]+\\])?\\)"; }
check "no names from student code in expect.tsv" "! student_names '$ROOT/test/sv/expect.tsv'"
# each form the check refuses, planted: Vivado's 'name' and (name_reg), yosys' `\name'
# shellcheck disable=SC2016   # the backquote is yosys' quote, not a command
st_names() {
    local f="$T/names.tsv"
    printf "id\tc\tsupported\tlog: done synthesizing module 'lab4top'\n" > "$f" && student_names "$f" | grep -q lab4top \
    && printf 'id\tc\tsupported\tSequential element (count_reg[3]) is unused\n' > "$f" && student_names "$f" | grep -q count_reg \
    && printf 'id\tc\tsupported\tlog: Net `\\x'"'"' in module `\\lab5top'"'"' has no driver\n' > "$f" && student_names "$f" | grep -q lab5top \
    || return 1
    # and a quoted name after each word the pattern knows
    local k; for k in module design variable signal instance cell port net register clock; do
        printf "id\tc\tsupported\tlog: %s 'stu_%s' was removed\n" "$k" "$k" > "$f" && student_names "$f" | grep -q "stu_$k" || return 1
    done
}
check "student-name check sees a quoted name" st_names
check "no sudo/eval/curl|sh"  "! grep -nE 'sudo |eval |curl.*\| *(ba)?sh' '$ROOT/install.sh' '$CLI'"
check "https only"            "! grep -n 'http://' '$ROOT/install.sh'"
# the three pages say how many checks this file has: the number test/run.sh --list prints, no other
pages_count() {
    local l n np; l=$(FULL='' "$ROOT/test/run.sh" --list) && n=$(tail -1 <<< "$l") && np=$(grep -E '^[0-9]+ probes$' <<< "$l") && [ "$(wc -l <<< "$np")" -eq 1 ] && [[ $n =~ ^[0-9]+\ checks$ ]] && n=${n%% *} && np=${np%% *} \
    && grep -qE "(^|[^0-9])$n checks" "$ROOT/README.md" && grep -qE "(^|[^0-9])$n kontrol" "$ROOT/README.tr.md" && grep -qE "(^|[^0-9])$n checks" "$ROOT/site/cli/index.html" \
    && grep -qE "(^|[^0-9])$np SystemVerilog probes" "$ROOT/README.md" && grep -qE "(^|[^0-9])$np SystemVerilog probe" "$ROOT/README.tr.md" && grep -qE "(^|[^0-9])$np of them the SystemVerilog probes" "$ROOT/site/cli/index.html"
}
check "README, README.tr and site/cli quote the numbers --list prints (checks, probes)" pages_count
# site/llms.txt (llmstxt.org) is generated from docs/errors.md and the guide: regenerating changes nothing, every code has a line and a page
llms_txt() {
    local f="$ROOT/site/llms.txt" c
    [ -s "$f" ] && head -1 "$f" | grep -q '^# dewfpga$' && sed -n 3p "$f" | grep -q '^> ' && grep -q '^## Errors$' "$f" \
    && cp "$f" "$T/llms.before" && (cd "$ROOT" && python3 -B docs/llms-build.py > /dev/null) && cmp -s "$f" "$T/llms.before" \
    && ! grep -q '](/' "$f" || return 1
    # every linked error page exists, every code of errors.md has a line, every guide anchor exists in the guide
    grep -oE 'errors/[a-z0-9-]+/' "$f" | cut -d/ -f2 | sort -u | while read -r c; do [ -s "$ROOT/site/errors/$c/index.html" ] || exit 1; done || return 1
    grep -oE '^## [a-z0-9][a-z0-9-]*$' "$ROOT/docs/errors.md" | cut -c4- | while read -r c; do grep -q "^- \[$c\](" "$f" || exit 1; done || return 1
    grep -oE 'docs/#[a-z0-9-]+' "$f" | cut -d# -f2 | while read -r c; do grep -q "id=\"$c\"" "$ROOT/site/docs/index.html" || exit 1; done
}
check "site/llms.txt: generated, idempotent, every error code listed with an existing page, guide anchors exist" llms_txt
check "--version"             "v=\$('$CLI' --version); [ -n \"\$v\" ] && [ \"\$v\" = \"\$(sed -n 's/.*\"version\": *\"\([^\"]*\)\".*/\1/p' '$ROOT/package.json')\" ]"

sec "== editor and Vivado project integration"
check "VS Code user tasks preserve JSONC and ownership" "python3 -B '$ROOT/test/vscode/test-tasks.py'"
check "VS Code extension chooser, diagnostics and fresh waveforms" "node '$ROOT/test/vscode/test-extension.js'"
check "VS Code setup and removal stay inside their test profiles" "python3 -B '$ROOT/test/vscode/test-setup.py' && python3 -B '$ROOT/test/vscode/test-setup-editor.py'"
check "Vivado project files, nested sources and includes" "bash '$ROOT/test/vivado/run.sh'"

sec "== machine-readable CLI"
check "JSON CLI protocol, cancellation and text parity" "python3 -B '$ROOT/test/agent/test-json.py'"

check "MCP protocol and owned SDK setup" "python3 -B '$ROOT/test/agent/test-mcp.py'"

sec "== toolchain"
check "check passes"          "'$CLI' check"

sec "== build (folder with only .sv + .xdc)"
mkdir -p "$T/w"; cp "$ROOT"/templates/{blink.sv,blink.xdc,blink_tb.sv} "$T/w/"
check "sim"                   "cd '$T/w' && '$CLI' sim | grep -q '^PASS: 3 checks'"
check "bit"                   "cd '$T/w' && '$CLI' bit && [ -s blink.bit ]"
# The golden .fasm is exact only for the yosys version it was made with (brew can't be pinned).
# With another yosys the netlist differs, so only the I/O placement (IOB lines = XDC pins) is compared.
# --list asks no tool anything (it has to print the same names before the toolchain is installed): the name
# it lists carries no version
if [ "$LIST" = 1 ]; then YV=; GV=; else YV=$(yosys -V | awk '{print $2}'); GV=$(cat "$ROOT/test/golden/yosys-version"); fi
if [ "$LIST" = 1 ] || [ "$YV" = "$GV" ]; then
    check "fasm == golden${YV:+ (yosys $YV)}" "diff <(strip '$T/w/blink.fasm') <(strip '$ROOT/test/golden/blink.fasm')"
else
    echo "  SKIP fasm == golden: yosys $YV here, golden made with $GV; checking I/O placement only"
    check "fasm I/O placement == golden" "diff <(grep -E '^[LR]IOB33' '$T/w/blink.fasm' | sort) <(grep -E '^[LR]IOB33' '$ROOT/test/golden/blink.fasm' | sort)"
fi
check "no warnings in output" "cd '$T/w' && '$CLI' clean && ! '$CLI' bit 2>&1 | grep -qiE 'warning|error'"
check "bit is deterministic"  "cd '$T/w' && cp blink.frames a && '$CLI' clean && '$CLI' bit >/dev/null && cmp a blink.frames"
# flash: in the '== inside the bitstream, and the board' block below (with and without a board)
check "bit output is short (<=3 lines)" "cd '$T/w' && '$CLI' clean && [ \$('$CLI' bit 2>&1 | wc -l) -le 3 ]"
check "bit prints xdc, pnr, bit lines" "cd '$T/w' && '$CLI' clean && out=\$('$CLI' bit 2>&1) && grep -q '^xdc ok' <<<\"\$out\" && grep -q '^pnr ok.*PASS' <<<\"\$out\" && grep -q '^blink.bit' <<<\"\$out\""
check "bit up to date: exit 0, one line" "cd '$T/w' && out=\$('$CLI' bit 2>&1) && [ \"\$out\" = 'blink.bit is up to date (nothing changed since the last build; dewfpga clean forces a rebuild)' ]"
check "full pnr log kept"       "cd '$T/w' && grep -q 'Max frequency' blink.log"

sec "== multi-file design"
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

sec "== error paths"
check "new: existing dir"     "{ '$CLI' new '$T/w' || true; } 2>&1 | grep -q 'already exists' && ! '$CLI' new '$T/w' 2>/dev/null"
check "unknown command"       "! '$CLI' nope 2>/dev/null"
check "check w/ empty home"   "! FPGA_HOME='$T/none' '$CLI' check >/dev/null"
check "bit w/o toolchain"     "cd '$T/w' && { FPGA_HOME='$T/none' '$CLI' bit || true; } 2>&1 | grep -q 'not installed'"
check "sim w/o testbench"     "cd '$T/m' && { '$CLI' sim top || true; } 2>&1 | grep -q 'testbench'"
check "failing testbench -> exit 1" "mkdir -p '$T/ft' && sed 's/assign led = .*/assign led = 16'\\''hFFFF;/' '$ROOT/templates/blink.sv' > '$T/ft/blink.sv' && cp '$ROOT/templates/blink_tb.sv' '$T/ft/' && cd '$T/ft' && ! '$CLI' sim >out 2>&1 && grep -q '^FAIL: 2 of 3' out && grep -qE 'reported [0-9]+ errors?' out"
check "timing not met -> error, no bit" "mkdir -p '$T/tm' && cp '$ROOT/templates/blink.sv' '$T/tm/' && sed 's/-period 10.00/-period 0.50/; s/-waveform {0 5}/-waveform {0 0.25}/' '$ROOT/templates/blink.xdc' > '$T/tm/blink.xdc' && cd '$T/tm' && ! '$CLI' bit >out 2>&1 && grep -q 'timing not met' out && [ ! -e blink.bit ] && [ ! -e blink.fasm ]"
check "file name with a space -> clear error" "mkdir -p '$T/spc' && cp '$ROOT/templates/blink.sv' '$T/spc/my blink.sv' && cp '$ROOT/templates/blink.xdc' '$T/spc/my blink.xdc' && cd '$T/spc' && ! '$CLI' bit >out 2>&1 && grep -q 'spaces are not supported' out"
check "unused xdc pins are ignored" "mkdir -p '$T/xa' && cp '$ROOT/templates/blink.sv' '$T/xa/' && sed 's/^#set_property/set_property/' '$ROOT/templates/Basys3_Master.xdc' > '$T/xa/blink.xdc' && cd '$T/xa' && '$CLI' bit >out 2>&1 && grep -q 'unused pins in the XDC ignored' out && [ -s blink.bit ]"
check "bit blink.sv works like bit blink" "cd '$T/w' && '$CLI' bit blink.sv"
check "help has no comment marks" "! '$CLI' --help | grep -q '^#'"
check "bit src/x -> run inside the folder" "cd '$T/w' && ! '$CLI' bit src/x >out 2>&1 && grep -q '^ERROR \[run-inside-the-folder\]: src/x is a path, .* Fix: run it inside the folder that holds the .sv files:  cd \"src\" && dewfpga bit x ' out"
check "bit --foo -> unknown option" "cd '$T/w' && ! '$CLI' bit --foo >out 2>&1 && grep -q '^ERROR \[unknown-option\]: unknown option: --foo; dewfpga bit takes a module or a file name' out"
check "FPGA_HOME with a space -> path-with-space, before any command" "cd '$T/w' && ! FPGA_HOME='$T/a b' '$CLI' check >out 2>&1 && grep -q '^ERROR \[path-with-space\]: a path with a space (.* / $T/a b): the FPGA tools cannot handle that' out"
check "UTF-8 BOM -> error names line 1 and the sed that strips it" "mkdir -p '$T/bom' && printf '\\xEF\\xBB\\xBF' > '$T/bom/blink.sv' && cat '$ROOT/templates/blink.sv' >> '$T/bom/blink.sv' && cp '$ROOT/templates/blink.xdc' '$T/bom/' && cd '$T/bom' && ! '$CLI' bit >out 2>&1 && grep -q '^blink.sv:1: ERROR \[utf8-bom\]: blink.sv starts with a byte-order mark' out && grep -q \"sed -i '' \" out && [ ! -e blink.bit ]"
# shellcheck disable=SC2016   # $finish and $stop are Verilog
check 'testbench without $finish -> sim-timeout, names SIM_TIMEOUT' "mkdir -p '$T/tmo' && cp '$ROOT/templates/blink.sv' '$T/tmo/' && printf 'module blink_tb;\\n logic clk = 0; logic [15:0] sw = 0; logic [15:0] led;\\n blink dut(.clk(clk), .sw(sw), .led(led));\\n always #5 clk = ~clk;\\nendmodule\\n' > '$T/tmo/blink_tb.sv' && cd '$T/tmo' && ! SIM_TIMEOUT=2 '$CLI' sim >out 2>&1 && grep -q '^ERROR \[sim-timeout\]: the simulation did not finish in 2 s: the testbench never reached \$finish' out && grep -q 'SIM_TIMEOUT=600 dewfpga sim' out"
# shellcheck disable=SC2016   # $stop is Verilog
check 'testbench ending with $stop -> sim ends, PASS line, exit 0' "mkdir -p '$T/stp' && cp '$ROOT/templates/blink.sv' '$T/stp/' && sed 's/[\$]finish;/\$stop;/' '$ROOT/templates/blink_tb.sv' > '$T/stp/blink_tb.sv' && grep -q 'stop;' '$T/stp/blink_tb.sv' && cd '$T/stp' && '$CLI' sim >out 2>&1 && grep -q '^PASS: 3 checks' out && grep -q 'blink_tb.sv:35: \$stop called' out"
# a Verilog-2005 testbench in a .v file (reg/wire, no logic): found by content, compiled with the .sv design
# shellcheck disable=SC2016   # $error, $display and $finish are Verilog
tb_dot_v() {
    mkdir -p "$T/tbv" && cp "$ROOT/templates/blink.sv" "$T/tbv/" && cd "$T/tbv" \
    && printf '`timescale 1ns/1ps\nmodule blink_tb;\n reg clk = 0; reg [15:0] sw = 0; wire [15:0] led;\n blink dut(.clk(clk), .sw(sw), .led(led));\n always #5 clk = ~clk;\n initial begin #100; if (led[15] !== 0) $error("led[15] must be 0"); sw[0] = 1; #100; if (led[15] !== 1) $error("led[15] must be 1"); $display("PASS: 2 checks"); $finish; end\nendmodule\n' > blink_tb.v \
    && "$CLI" sim > out 2>&1 && grep -q '^iverilog -g2012 -o blink_sim blink.sv blink_tb.v$' out && grep -q '^PASS: 2 checks' out
}
check "testbench named _tb.v (Verilog-2005) -> sim finds and runs it" tb_dot_v
check "missing IOSTANDARD -> error names the XDC line and the add line" "rm -rf '$T/io' && cp -Rp '$T/w' '$T/io' && cd '$T/io' && sed -i '' 's/PACKAGE_PIN U16  IOSTANDARD LVCMOS33/PACKAGE_PIN U16/' blink.xdc && ! '$CLI' bit >out 2>&1 && grep -q '^blink.xdc:27: ERROR \[no-iostandard-property\]: led\[0\] has a PACKAGE_PIN but no IOSTANDARD in the XDC.* Fix: add the line  set_property IOSTANDARD LVCMOS33 \[get_ports {led\[0\]}\]' out"
check "failed build removes the old .bit" "rm -rf '$T/ob' && cp -Rp '$T/w' '$T/ob' && cd '$T/ob' && [ -s blink.bit ] && echo 'garbage;' >> blink.sv && ! '$CLI' bit >out 2>&1 && grep -q '^blink.sv:35: ERROR' out && [ ! -e blink.bit ] && [ ! -e blink.fasm ]"
# #29: a build that fails after synthesis (a wrong pin name in the XDC: nextpnr alone stopped with "device does not
# have a pin named 'ZZ99'", no file:line, and the old blink.bit stayed next to the sources, byte for byte) names
# the XDC line and leaves none of the old outputs; flash after it builds again, stops at the same line and never
# programs yesterday's design (no openFPGALoader line in its output)
check "wrong pin name in the XDC -> no-such-pin names the line, old .bit/.fasm/.frames gone, flash does not program" "rm -rf '$T/np' && cp -Rp '$T/w' '$T/np' && cd '$T/np' && [ -s blink.bit ] && sed -i '' 's/PACKAGE_PIN W5 /PACKAGE_PIN ZZ99/' blink.xdc && ! '$CLI' bit >out 2>&1 && grep -q '^blink.xdc:5: ERROR \[no-such-pin\]: ZZ99 is not an I/O pin of the Basys3.*Basys3_Master.xdc puts clk on W5' out && [ ! -e blink.bit ] && [ ! -e blink.fasm ] && [ ! -e blink.frames ] && [ ! -e blink_routed.json ] && ! '$CLI' flash >out2 2>&1 && grep -q 'no-such-pin' out2 && ! grep -qiE 'ftdi|openFPGALoader' out2"
check "pin in small letters (w5) -> no-such-pin says W5" "rm -rf '$T/lp' && cp -Rp '$T/w' '$T/lp' && cd '$T/lp' && sed -i '' 's/PACKAGE_PIN W5 /PACKAGE_PIN w5 /' blink.xdc && ! '$CLI' bit >out 2>&1 && grep -q '^blink.xdc:5: ERROR \[no-such-pin\]: w5 is written in small letters.* Fix: write  PACKAGE_PIN W5  on this line' out && [ ! -e blink.bit ]"
check "two ports on one pin -> pin-used-twice names both lines" "rm -rf '$T/tp' && cp -Rp '$T/w' '$T/tp' && cd '$T/tp' && sed -i '' 's/PACKAGE_PIN W5 /PACKAGE_PIN U16/' blink.xdc && ! '$CLI' bit >out 2>&1 && grep -q '^blink.xdc:27: ERROR \[pin-used-twice\]: pin U16 is given to 2 ports, clk (blink.xdc:5) and led\[0\] (blink.xdc:27).*clk is on W5, led\[0\] is on U16' out && [ ! -e blink.bit ]"
# with the XDC check out of the way (a checker that does nothing) nextpnr's own lines stop the build, and each gets the code and the XDC line
nopins() { printf 'pass\n' > "$T/noop.py" && make -s -f "$ROOT/templates/Makefile" TOP=blink SRCS=blink.sv XDC=blink.xdc CHECKER="$T/noop.py" bit; }
check "nextpnr's own 'does not have a pin named' line gets the code and the XDC line" "cd '$T/lp' && ! nopins >out 2>&1 && grep -q \"^ERROR: Unable to constrain IO 'clk', device does not have a pin named 'w5'\" out && grep -q '^blink.xdc:5: ERROR \[no-such-pin\]: w5 is not an I/O pin of the Basys3' out && [ ! -e blink.bit ]"
check "nextpnr's own 'already bound to cell' line gets the code pin-used-twice and the XDC line" "cd '$T/tp' && ! nopins >out 2>&1 && grep -q \"cannot be bound to bel 'IOB_X0Y3/IOB33/PAD' since it is already bound to cell\" out && grep -qE '^blink.xdc:(5|27): ERROR \[pin-used-twice\]: (clk and led\[0\]|led\[0\] and clk) are on the same pin' out && [ ! -e blink.bit ]"
# uninstall, from a copy of the CLI: the real one may be what Homebrew's bin/dewfpga links to, and uninstall
# removes that link when it points at the CLI that runs (a fake FPGA_HOME holds three of the six entries and a file of the student's)
un_copy() { rm -rf "$T/un" && mkdir -p "$T/un" && cp -R "$ROOT/bin" "$ROOT/package.json" "$T/un/" && cp "$ROOT/.fpga_home" "$T/un/" 2>/dev/null || true; }
# the lines name the folder uninstall resolved (physical path, /private/var on macos); the harness holds the symlinked one
un_basic() {
    local p; un_copy && mkdir -p "$T/uh/nextpnr-xilinx" "$T/uh/chipdb" "$T/uh/mine" && touch "$T/uh/install.log" "$T/uh/mine/keep.sv" && p=$(cd "$T/uh" && pwd -P) \
    && FPGA_HOME="$T/uh" "$T/un/bin/dewfpga" uninstall >"$T/un.out" 2>&1 && grep -qF "removing: $p/chipdb" "$T/un.out" && grep -qF "kept: $p (other files live there)" "$T/un.out" && grep -q '^done\.$' "$T/un.out" \
    && [ ! -e "$T/uh/chipdb" ] && [ ! -e "$T/uh/install.log" ] && [ -e "$T/uh/mine/keep.sv" ] && { [ -L /opt/homebrew/bin/dewfpga ] || [ ! -e /opt/homebrew/bin/dewfpga ]; }
}
check "uninstall removes what install built, keeps the rest, keeps the folder" un_basic
check "uninstall with nothing installed -> note, exit 0" "un_copy && mkdir -p '$T/uh2' && FPGA_HOME='$T/uh2' '$T/un/bin/dewfpga' uninstall >'$T/un.out' 2>&1 && grep -q '^note \[no-install-found\]: nothing to remove: no dewfpga install found in $T/uh2' '$T/un.out'"
# the second reader (#4): an unpacked array concatenation, which yosys' own reader refuses and yosys-slang builds
slang_design() { mkdir -p "$1" && printf 'module top(input logic [15:0] sw, output logic [15:0] led);\n  logic [3:0] arr [0:1];\n  assign arr = {sw[3:0], sw[7:4]};\n  assign led = {8'"'"'d0, arr[0], arr[1]};\nendmodule\n' > "$1/top.sv" && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > "$1/top.xdc"; }
check "a design only yosys-slang reads builds, with the note" "slang_design '$T/sl' && cd '$T/sl' && '$CLI' bit >out 2>&1 && grep -q '^note \[read-with-slang\]: top read with yosys-slang, the second reader' out && grep -q '^pnr ok' out && [ -s top.bit ]"
check "with slang.so absent the note names the install step" "slang_design '$T/sl2' && cd '$T/sl2' && ! SLANG='$T/none/slang.so' '$CLI' bit >out 2>&1 && grep -q '^top.sv:3: ERROR: ' out && grep -q '^note \[second-reader-missing\]: yosys. own reader refused this code, and yosys-slang, the second reader .* is not installed: $T/none/slang.so not found. Fix: run  dewfpga install' out && [ ! -e top.bit ]"
# sim on a design iverilog refuses (#28): the simulation runs on the design as the build reads it, with the note.
# A unique if, which iverilog 13 does not parse and yosys' own reader builds; a ref argument, which the build's scan
# refuses before either reader (sim has to refuse it too, never print PASS); a testbench iverilog refuses, where
# iverilog's verdict stays as it was and no build starts; a design both readers refuse (a missing ;), where the
# build's coded line and iverilog's are both printed; and blink, whose sim is iverilog's alone: the same four lines,
# no note, no build output left behind
# shellcheck disable=SC2016   # $error, $display and $finish are Verilog
uq_design() { mkdir -p "$1" && printf 'module top(input logic [15:0] sw, output logic [15:0] led);\n  always_comb begin\n    unique if (sw[0]) led = 16'"'"'h0001; else led = 16'"'"'h0000;\n  end\nendmodule\n' > "$1/top.sv" \
    && printf 'module top_tb;\n  logic [15:0] sw = 0; logic [15:0] led;\n  top dut(.sw(sw), .led(led));\n  initial begin\n    #1 if (led !== 0) $error("led must be 0");\n    sw[0] = 1; #1 if (led !== 1) $error("led must be 1");\n    $display("PASS: 2 checks"); $finish;\n  end\nendmodule\n' > "$1/top_tb.sv" && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > "$1/top.xdc"; }
check "sim: a design iverilog refuses (unique if) runs on the design as the build reads it, with the note" "uq_design '$T/uq' && cd '$T/uq' && '$CLI' sim >out 2>&1 && grep -q '^top.sv:3: syntax error' out && grep -q '^top.sv:3: note \[sim-from-build\]: iverilog cannot compile this design (its lines are above), so the simulation runs on the design as the build reads it: read by yosys. own reader, written back as Verilog (top_sim.elab) and compiled with the testbench and yosys. models of the Xilinx cells. What differs: ' out && grep -q '^iverilog -g2012 -l .*cells_sim.v -o top_sim top_sim.elab top_tb.sv$' out && grep -q '^PASS: 2 checks' out && [ -s top_sim.elab ] && [ -s top.json ] && ! grep -q 'ERROR' out"
# shellcheck disable=SC2016   # $display and $finish are Verilog
ref_design() { mkdir -p "$1" && printf 'module top(input logic [15:0] sw, output logic [15:0] led);\n  function automatic void inc(ref logic [3:0] x); x = x + 4'"'"'d1; endfunction\n  logic [3:0] v;\n  always_comb begin v = sw[3:0]; inc(v); led = {12'"'"'d0, v}; end\nendmodule\n' > "$1/top.sv" \
    && printf 'module top_tb;\n  logic [15:0] sw = 0; logic [15:0] led;\n  top dut(.sw(sw), .led(led));\n  initial begin #1 $display("PASS: 0 checks"); $finish; end\nendmodule\n' > "$1/top_tb.sv" && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > "$1/top.xdc"; }
check "sim: a design the build refuses (ref argument) is refused by sim too: the build's coded line, then iverilog's, no PASS" "ref_design '$T/ref' && cd '$T/ref' && ! '$CLI' sim >out 2>&1 && grep -q '^top.sv:2: sorry: Reference ports not supported yet.' out && grep -q '^top.sv:2: ERROR \[ref-argument\]: function inc takes an argument by reference (ref logic \[3:0\] x)' out && grep -q '^top.sv:2: ERROR \[iverilog-refused\]: iverilog cannot compile this code (its message is above), and the build refuses the design too (its lines are above). Fix: fix the first line it names' out && ! grep -q '^PASS' out && ! grep -q 'sim-from-build' out && [ ! -e top_sim ] && [ ! -e top_sim.elab ] && [ ! -e top.json ]"
check "sim: a testbench iverilog refuses keeps iverilog's verdict as it was: no note, no build" "mkdir -p '$T/tbr' && cp '$ROOT/templates/blink.sv' '$ROOT/templates/blink.xdc' '$T/tbr/' && sed 's/[\$]finish;/\$finish/' '$ROOT/templates/blink_tb.sv' > '$T/tbr/blink_tb.sv' && cd '$T/tbr' && ! '$CLI' sim >out 2>&1 && grep -q '^blink_tb.sv:36: syntax error' out && grep -q '^blink_tb.sv:36: ERROR \[iverilog-refused\]: iverilog cannot compile this code (its message is above). Fix: fix the first line it names; the errors after the first often follow from it. https://' out && ! grep -qE 'sim-from-build|build refuses|read-with-slang' out && [ ! -e blink.json ] && [ ! -e blink.il ] && [ ! -e blink_sim.elab ]"
check "sim: a design both readers refuse (a missing ;) prints the build's coded line and iverilog's" "mkdir -p '$T/twor' && cp '$ROOT/test/agent/fixtures/syntax.sv' '$ROOT/test/agent/fixtures/syntax_tb.sv' '$T/twor/' && cd '$T/twor' && ! '$CLI' sim >out 2>&1 && grep -q '^syntax.sv:3: syntax error' out && grep -q \"^yosys' reader:\" out && grep -q '^  syntax.sv:3: ERROR: syntax error' out && grep -q '^syntax.sv:2: ERROR \[slang-refused\]: expected .;. (yosys-slang, the second reader' out && grep -q '^syntax.sv:3: ERROR \[iverilog-refused\]: iverilog cannot compile this code (its message is above), and the build refuses the design too (its lines are above)' out && ! grep -q 'sim-from-build' out && [ ! -e syntax_sim ]"
# shellcheck disable=SC2016   # $finish is Verilog
blink_sim_plain() {
    rm -rf "$T/bs" && mkdir -p "$T/bs" && cp "$ROOT"/templates/{blink.sv,blink.xdc,blink_tb.sv} "$T/bs/" && cd "$T/bs" && "$CLI" sim > out 2>&1 \
    && printf 'iverilog -g2012 -o blink_sim blink.sv blink_tb.sv\nVCD info: dumpfile blink.vcd opened for output.\nPASS: 3 checks (see the waveform for the toggle)\nblink_tb.sv:35: $finish called at 200000 (1ps)\n' | diff - out \
    && [ ! -e blink.json ] && [ ! -e blink.il ] && [ ! -e blink_sim.elab ]
}
check "sim: blink is iverilog's alone: the same four lines, no note, no build started" blink_sim_plain
# two clocks: a divided clock the student named (slow) clocks a counter; the pnr line reports each clock by name
two_clocks() {
    mkdir -p "$T/2c" && cd "$T/2c" && printf 'module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n  logic slow = 0; always_ff @(posedge clk) slow <= ~slow;\n  logic [15:0] c = 0; always_ff @(posedge slow) c <= c + sw;\n  assign led = c;\nendmodule\n' > top.sv \
    && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > top.xdc && "$CLI" bit > out 2>&1 && [ -s top.bit ] \
    && grep -qE '^pnr ok: [0-9]+ LUT, [0-9]+ FF, .*slow [0-9.]+ MHz \(PASS at [0-9.]+ MHz\)' out && grep -qE '^pnr ok: .*clk [0-9.]+ MHz \(PASS at 100\.00 MHz\)' out
}
check "two clocks -> the pnr line reports each by name" two_clocks
check "no create_clock -> checked at 100 MHz" "mkdir -p '$T/nc' && cp '$ROOT/templates/blink.sv' '$T/nc/' && grep -v create_clock '$ROOT/templates/blink.xdc' > '$T/nc/blink.xdc' && cd '$T/nc' && '$CLI' bit >out 2>&1 && grep -q 'PASS at 100.00 MHz' out && grep -q 'no create_clock' out"
check ".v file with SystemVerilog inside -> stops naming the .v line (a .v is Verilog-2005, as in Vivado)" "mkdir -p '$T/vv' && cp '$ROOT/templates/blink.sv' '$T/vv/blink.v' && cp '$ROOT/templates/blink.xdc' '$T/vv/' && cd '$T/vv' && ! '$CLI' bit >out 2>&1 && grep -qE '^blink\.v:[0-9]+: ERROR \[' out && [ ! -e blink.bit ]"
check "module name != file name -> builds, output named after the module" "mkdir -p '$T/mn' && sed 's/module blink/module top/' '$ROOT/templates/blink.sv' > '$T/mn/lab4.sv' && cp '$ROOT/templates/blink.xdc' '$T/mn/lab4.xdc' && cd '$T/mn' && '$CLI' bit >out 2>&1 && [ -s top.bit ]"
check "course SevSeg port line fixed in place, build goes through" "mkdir -p '$T/ss' && printf 'module ss(input clk, output [6:0]seg, logic dp, output [3:0] an);\\n assign seg = 7'\\''h55; assign dp = 1; assign an = 4'\\''b1110;\\nendmodule\\n' > '$T/ss/ss.sv' && grep -E 'seg|an\\[|dp|clk' '$ROOT/templates/Basys3_Master.xdc' | sed 's/^#//' > '$T/ss/ss.xdc' && cd '$T/ss' && '$CLI' bit >out 2>&1 && grep -q 'wrote the port direction' out && grep -q 'output logic dp' ss.sv && [ -s ss.bit ]"
check "vivado funcsim netlist -> named, not fed to yosys" "mkdir -p '$T/nl' && cp '$ROOT/templates/blink.sv' '$ROOT/templates/blink.xdc' '$T/nl/' && printf '// Tool Version: Vivado v.2021.2\\n// Purpose : This verilog netlist is a functional simulation representation of the design\\n(* NotValidForBitStream *)\\nmodule leftover(input a, output b); assign b = a; endmodule\\n' > '$T/nl/leftover_func_impl.v' && cd '$T/nl' && ! '$CLI' bit >out 2>&1 && grep -q 'netlist Vivado wrote after synthesis' out"
ui_build() { mkdir -p "$T/ui" && printf 'module sub(input a, output b); assign b = a; endmodule\nmodule ui(input logic [1:0] sw, output logic [1:0] led);\n sub(sw[0], led[0]);\n assign led[1] = sw[1];\nendmodule\n' > "$T/ui/ui.sv" && cp "$ROOT/templates/blink.xdc" "$T/ui/ui.xdc" && cd "$T/ui" && "$CLI" bit > out 2>&1; }
check "unnamed instance -> named in place with a note, build goes through" "ui_build && grep -q 'ui.sv:3: note \[unnamed-instance\]: named the instance:  sub u_sub(' out && grep -q 'sub u_sub(sw\\[0\\], led\\[0\\]);' ui.sv && [ -s ui.bit ]"
# run against a scratch HOME: the day the guard breaks, the test must delete a scratch folder, not the real ~/venv
check "uninstall refuses FPGA_HOME=HOME" "mkdir -p '$T/home/fpga' '$T/home/venv' && ! HOME='$T/home' FPGA_HOME='$T/home' '$CLI' uninstall >out 2>&1 && grep -q 'refusing' out && [ -d '$T/home/fpga' ] && [ -d '$T/home/venv' ]"
# physical paths (#7): FPGA_HOME=$HOME/., a link that points at HOME and a parent of HOME name the same folder
check "uninstall refuses FPGA_HOME=HOME/. and a link to HOME" "rm -rf '$T/home' && mkdir -p '$T/home/venv' && ln -sfn '$T/home' '$T/hlink' && ! HOME='$T/home' FPGA_HOME='$T/home/.' say '$CLI' uninstall && grep -q 'ERROR \[fpga-home-unsafe\]' '$T/say' && ! HOME='$T/home' FPGA_HOME='$T/hlink' say '$CLI' uninstall && grep -q 'ERROR \[fpga-home-unsafe\]' '$T/say' && [ -d '$T/home/venv' ]"
check "uninstall refuses FPGA_HOME = a parent of HOME" "mkdir -p '$T/par/home/venv' '$T/par/venv' && ! HOME='$T/par/home' FPGA_HOME='$T/par' say '$CLI' uninstall && grep -q 'parent of your home folder' '$T/say' && [ -d '$T/par/venv' ] && [ -d '$T/par/home/venv' ]"
# x/l/.. with l a link: bash's cd folds the string to x, rm follows the link first and lands beside its target. The guard
# and the deletes must both act on the folder the kernel resolves: y/venv goes (named), x/venv stays; and when the link
# points into HOME, x/l/.. is HOME and uninstall refuses (the string x/l/.. spelled ~/venv without saying so)
un_link() {
    un_copy || return 1
    local u="$T/ul" y; rm -rf "$u" && mkdir -p "$u/home/sub" "$u/home/venv" "$u/y/sub" "$u/y/venv" "$u/x/venv" && ln -s "$u/y/sub" "$u/x/l" && ln -s "$u/home/sub" "$u/x/lh" && y=$(cd "$u/y" && pwd -P) \
    && HOME="$u/home" FPGA_HOME="$u/x/l/.." say "$T/un/bin/dewfpga" uninstall && grep -qF "removing: $y/venv" "$T/say" && ! grep -q 'removing: .*/x/l/' "$T/say" && [ ! -e "$u/y/venv" ] && [ -d "$u/x/venv" ] \
    && ! HOME="$u/home" FPGA_HOME="$u/x/lh/.." say "$T/un/bin/dewfpga" uninstall && grep -q 'ERROR \[fpga-home-unsafe\]' "$T/say" && [ -d "$u/home/venv" ] && [ -d "$u/x/venv" ]
}
check "uninstall through a link's .. acts on the folder the path resolves to, not the one the string spells; refuses when that is HOME" un_link
# CDPATH set and a relative FPGA_HOME: cd would pick CDPATH's folder and print it; uninstall must take the one under the current folder
un_cdpath() {
    un_copy || return 1
    local c="$T/cdp" p; rm -rf "$c" && mkdir -p "$c/cwd/fh/venv" "$c/other/fh/venv" "$c/home" && p=$(cd "$c/cwd/fh" && pwd -P) \
    && (cd "$c/cwd" && CDPATH="$c/other" HOME="$c/home" FPGA_HOME=fh say "$T/un/bin/dewfpga" uninstall) && grep -qF "removing: $p/venv" "$T/say" && [ ! -e "$c/cwd/fh" ] && [ -d "$c/other/fh/venv" ]
}
check "uninstall with CDPATH set and a relative FPGA_HOME removes under the current folder, not CDPATH's" un_cdpath
# the web installer (site/install) against a scratch HOME, a scratch brew prefix and a stub release on a file:// url.
# It replaces DEWFPGA_DIR, so it must refuse HOME, HOME/., a link to HOME, /, a parent of HOME and a folder with the
# student's files and a git clone of the repo, and must accept an empty folder, a path that does not exist yet and an earlier dewfpga install
# shellcheck disable=SC2016  # the stub brew's $1 is meant for its own shell
wi_setup() {
    rm -rf "$T/wi" && mkdir -p "$T/wi/home" "$T/wi/brew/bin" "$T/wi/bin" "$T/wi/site" "$T/wi/rel/dewfpga/bin" \
    && printf '#!/bin/sh\n[ "$1" = --prefix ] && echo "%s"\n' "$T/wi/brew" > "$T/wi/bin/brew" && chmod +x "$T/wi/bin/brew" \
    && printf '#!/bin/sh\necho stub\n' > "$T/wi/rel/dewfpga/bin/dewfpga" && printf '#!/bin/sh\n' > "$T/wi/rel/dewfpga/install.sh" \
    && printf '{ "name": "dewfpga", "version": "0.0.0" }\n' > "$T/wi/rel/dewfpga/package.json" \
    && (cd "$T/wi/rel" && tar -czf "$T/wi/site/dewfpga.tgz" dewfpga) && (cd "$T/wi/site" && LC_ALL=C shasum -a 256 dewfpga.tgz > dewfpga.tgz.sha256)
}
# wi <DEWFPGA_DIR, or "" for the default>: runs the installer, prints its output (kept in $T/wi/out), returns its status
# shellcheck disable=SC2030  # the exports are for the installer's subshell only
wi() { ( export LC_ALL=C HOME="$T/wi/home" PATH="$T/wi/bin:$PATH" DEWFPGA_URL="file://$T/wi/site"; [ -z "$1" ] || export DEWFPGA_DIR="$1"; bash "$ROOT/site/install" ) >"$T/wi/out" 2>&1; local r=$?; cat "$T/wi/out"; return $r; }
check "web installer: fresh HOME -> ~/.dewfpga, link in brew's bin, sha256 ok" "wi_setup && wi '' && grep -q 'sha256 ok' '$T/wi/out' && [ -f '$T/wi/home/.dewfpga/bin/dewfpga' ] && [ '$T/wi/brew/bin/dewfpga' -ef '$T/wi/home/.dewfpga/bin/dewfpga' ]"
check "web installer: re-run replaces the folder, a file removed upstream does not linger" "touch '$T/wi/home/.dewfpga/stale.txt' && wi '' && [ -f '$T/wi/home/.dewfpga/bin/dewfpga' ] && [ ! -e '$T/wi/home/.dewfpga/stale.txt' ]"
check "web installer: refuses DEWFPGA_DIR=HOME, HOME/. and a link to HOME, keeps HOME" "touch '$T/wi/home/mine.txt' && ln -sfn '$T/wi/home' '$T/wi/hlink' && ! wi '$T/wi/home' && grep -q 'refusing to replace that folder' '$T/wi/out' && ! wi '$T/wi/home/.' && grep -q 'refusing' '$T/wi/out' && ! wi '$T/wi/hlink' && grep -q 'refusing' '$T/wi/out' && [ -f '$T/wi/home/mine.txt' ] && [ -f '$T/wi/home/.dewfpga/bin/dewfpga' ]"
check "web installer: refuses / and a parent of HOME" "! wi / && grep -q 'refusing' '$T/wi/out' && ! wi '$T/wi' && grep -q 'parent of your home folder' '$T/wi/out' && [ -f '$T/wi/home/mine.txt' ] && [ -f '$T/wi/site/dewfpga.tgz' ]"
check "web installer: refuses a folder with the student's files, keeps them" "mkdir -p '$T/wi/mine' && echo keep > '$T/wi/mine/lab.sv' && ! wi '$T/wi/mine' && grep -q 'not a dewfpga install' '$T/wi/out' && [ \"\$(cat '$T/wi/mine/lab.sv')\" = keep ]"
check "web installer: a path that does not exist yet is created" "wi '$T/wi/new/deep' && [ -f '$T/wi/new/deep/bin/dewfpga' ]"
# the earlier install is moved aside before the new tree moves in, never removed first: a parent folder the
# installer cannot write makes that first move fail, and the install in place has to stay whole
wi_ro() { chmod 555 "$T/wi/new"; local r=0; wi "$T/wi/new/deep" && r=1; chmod 755 "$T/wi/new"; [ "$r" = 0 ] && grep -q 'could not reserve a backup folder beside' "$T/wi/out" && [ -f "$T/wi/new/deep/bin/dewfpga" ] && ! ls -d "$T/wi/new/.dewfpga-backup."* >/dev/null 2>&1; }
check "web installer: a parent folder it cannot write -> stops, the install in place stays" wi_ro
# a move of the new tree that fails halfway leaves part of it at the target: the old tree must go back whole, not inside it
# shellcheck disable=SC2016  # the stub mv's $1 and $2 are meant for its own shell
wi_rb() {
    local d="$T/wi/new/deep" r=0 prior="$T/wi/new/.dewfpga-backup.prior" b
    mkdir -p "$prior/old" && echo prior > "$prior/old/keep.txt" \
    && printf '#!/bin/sh\ncase "$1" in */new) mkdir -p "$2" && touch "$2/partial"; exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$T/wi/bin/mv" && chmod +x "$T/wi/bin/mv" && echo old > "$d/old.txt"
    wi "$d" && r=1; rm -f "$T/wi/bin/mv"
    [ "$r" = 0 ] && grep -q 'the earlier install is back in place' "$T/wi/out" && [ "$(cat "$d/old.txt")" = old ] && [ -f "$d/bin/dewfpga" ] && [ ! -e "$d/partial" ] \
    && [ "$(cat "$prior/old/keep.txt")" = prior ] && b=$(ls -d "$T/wi/new"/.dewfpga-backup.*) && [ "$(wc -l <<< "$b")" -eq 1 ] && rm -rf "$prior"
}
check "web installer: the new tree's move fails halfway -> the earlier install is back whole, and only then says so; a backup left by an earlier run stays" wi_rb
# the move back fails too: the earlier install is still whole, in the backup folder the message names; nothing half-moved stays at the target
# shellcheck disable=SC2016  # the stub mv's $1 and $2 are meant for its own shell
wi_rb2() {
    local d="$T/wi/new/deep" r=0 b bp
    printf '#!/bin/sh\ncase "$1" in */new) mkdir -p "$2" && touch "$2/partial"; exit 1 ;; */old) exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$T/wi/bin/mv" && chmod +x "$T/wi/bin/mv"
    wi "$d" && r=1; rm -f "$T/wi/bin/mv"
    b=$(ls -d "$T/wi/new"/.dewfpga-backup.* 2>/dev/null) || b=
    # the message prints the physical path (/private/var on macos), the harness has the symlinked one
    [ "$r" = 0 ] && grep -q 'nor the earlier install back; it is in' "$T/wi/out" && [ ! -e "$d" ] \
    && [ -n "$b" ] && [ "$(wc -l <<< "$b")" -eq 1 ] && bp=$(cd "$b" && pwd -P) && grep -qF "it is in $bp/old" "$T/wi/out" \
    && [ "$(cat "$b/old/old.txt")" = old ] && [ -f "$b/old/bin/dewfpga" ] && r=0 || r=1
    # put the earlier install back for the checks after this one, whatever the verdict
    if [ -n "$b" ] && [ -d "$b/old" ] && [ ! -e "$d" ]; then mv "$b/old" "$d" && rmdir "$b"; fi
    [ "$r" = 0 ]
}
check "web installer: the move back fails too -> the earlier install is whole in the folder the message names, nothing at the target" wi_rb2
# the same on a fresh install: the half-moved folder must go, or the next run refuses it as somebody's files
# shellcheck disable=SC2016  # the stub mv's $1 and $2 are meant for its own shell
wi_fresh() {
    local d="$T/wi/fresh" r=0
    rm -rf "$d" && printf '#!/bin/sh\ncase "$1" in */new) mkdir -p "$2" && touch "$2/partial"; exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$T/wi/bin/mv" && chmod +x "$T/wi/bin/mv"
    wi "$d" && r=1; rm -f "$T/wi/bin/mv"
    [ "$r" = 0 ] && grep -q 'could not move the files into' "$T/wi/out" && [ ! -e "$d" ] && ! ls -d "$T/wi/.dewfpga-backup."* >/dev/null 2>&1 \
    && wi "$d" && [ -f "$d/bin/dewfpga" ] && ! ls -d "$T/wi/.dewfpga-backup."* >/dev/null 2>&1
}
check "web installer: a fresh install's move fails halfway -> nothing half-moved is left, the next run installs" wi_fresh
# a folder the installer cannot read (mode 0100) lists as empty: its files would be moved aside unseen and never come back
wi_unread() {
    local d="$T/wi/unread" r=0; rm -rf "$d" && mkdir -p "$d" && echo keep > "$d/lab.sv" && chmod 0100 "$d"
    wi "$d" && r=1; chmod 755 "$d" "$T/wi"/.dewfpga-backup.*/old 2>/dev/null
    if ! { [ "$r" = 0 ] && grep -q 'cannot be read' "$T/wi/out" && [ "$(cat "$d/lab.sv")" = keep ] && ! ls -d "$T/wi/.dewfpga-backup."* >/dev/null 2>&1; }; then r=1; fi
    rm -rf "$T/wi"/.dewfpga-backup.*; [ "$r" = 0 ]
}
check "web installer: a folder it cannot read -> stops, the files in it stay where they are" wi_unread
# the same three Macs as install_brew_diag, through the front door: a curl|bash student with brew in /opt/homebrew but
# off the PATH must get the PATH line here too, not "Homebrew missing" (before #11 site/install only ran `command -v brew`).
# PATH is cut to the system dirs, no scratch brew; the installer stops before any download, so no release is needed
wi_brew_diag() {
    local d="$T/wbd" out
    rm -rf "$d"; mkdir -p "$d/as/opt/homebrew/bin" "$d/intel/usr/local/bin" "$d/home"
    printf '#!/bin/sh\n: > "%s"\nexit 77\n' "$d/invoked" > "$d/as/opt/homebrew/bin/brew"; cp "$d/as/opt/homebrew/bin/brew" "$d/intel/usr/local/bin/brew"
    chmod +x "$d/as/opt/homebrew/bin/brew" "$d/intel/usr/local/bin/brew"
    run() { out=$( { PATH=/usr/bin:/bin HOME="$d/home" DEWFPGA_URL="file://$d/nosite" DEWFPGA_BREW_PATHS="$1" bash "$ROOT/site/install" || true; } 2>&1 ); }
    run "$d/none/opt/homebrew/bin/brew $d/none/usr/local/bin/brew"
    grep -q 'ERROR: Homebrew missing' <<< "$out" || { echo "no brew: $out"; return 1; }
    run "$d/as/opt/homebrew/bin/brew $d/intel/usr/local/bin/brew"
    grep -q "Homebrew is installed ($d/as/opt/homebrew/bin/brew) but not on your PATH" <<< "$out" || { echo "brew off PATH: $out"; return 1; }
    grep -q 'Homebrew missing' <<< "$out" && { echo "brew off PATH still says missing: $out"; return 1; }
    local line; line=$(grep "zprofile" <<< "$out")
    (cd "$d/home" && HOME="$d/home" /bin/sh -c "$line") || { echo "echo line failed: $line"; return 1; }
    [ "$(PATH=/usr/bin:/bin /bin/sh -c '. '"$d"'/home/.zprofile && command -v brew')" = "$d/as/opt/homebrew/bin/brew" ] || { echo "brew not resolvable after .zprofile: $(cat "$d/home/.zprofile")"; return 1; }
    run "$d/intel/usr/local/bin/brew"
    grep -q "Intel Homebrew was found at $d/intel/usr/local/bin/brew" <<< "$out" || { echo "intel brew: $out"; return 1; }
    out=$( { PATH="$d/intel/usr/local/bin:/usr/bin:/bin" HOME="$d/home" FPGA_HOME="$T/e" DEWFPGA_URL="file://$d/nosite" DEWFPGA_BREW_PATHS="$d/as/opt/homebrew/bin/brew" bash "$ROOT/site/install" || true; } 2>&1 )
    grep -q "brew command on your PATH is $d/intel/usr/local/bin/brew" <<< "$out" || { echo "Intel brew on PATH: $out"; return 1; }
    [ ! -e "$d/invoked" ] || { echo "a brew candidate was executed during diagnosis"; return 1; }
    [ ! -e "$d/home/.dewfpga" ] || { echo "the installer went on past the brew check"; return 1; }
}
check "web installer: brew absent, brew off the PATH and Intel brew get the three install.sh messages, and stop before any download" wi_brew_diag
# the earlier install holds a folder rm cannot empty (mode 000 with a file inside): the new install is in place, so the
# installer goes on and names where the old one is left, instead of ending on rm's line alone (set -e)
wi_keep() {
    local d="$T/wi/new/deep" r=0 b; mkdir -p "$d/locked/inner" && echo lock > "$d/locked/inner/f" && chmod 000 "$d/locked"
    wi "$d" || r=1
    b=$(ls -d "$T/wi/new"/.dewfpga-backup.* 2>/dev/null) || b=
    [ "$r" = 0 ] && grep -q 'sha256 ok' "$T/wi/out" && grep -q 'note: the earlier install could not be removed; it is in' "$T/wi/out" && [ -f "$d/bin/dewfpga" ] && [ ! -e "$d/locked" ] \
    && [ -n "$b" ] && [ "$(wc -l <<< "$b")" -eq 1 ] && grep -qF "it is in $(cd "$b" && pwd -P)/old" "$T/wi/out" && [ -d "$b/old/locked" ] || r=1
    chmod -R u+rwx "$T/wi/new"/.dewfpga-backup.* 2>/dev/null; rm -rf "$T/wi/new"/.dewfpga-backup.*; [ "$r" = 0 ]
}
check "web installer: the earlier install has a folder rm cannot remove -> the new one is in place, the message names where the old one is left" wi_keep
# the new tree's move fails halfway and the half-moved copy cannot be removed either (a locked folder in it): a fresh
# install says so and names it; over an earlier install, the old tree stays whole in the backup folder the message names
# shellcheck disable=SC2016  # the stub mv's $1 and $2 are meant for its own shell
wi_stuck() {
    local d="$T/wi/stuck" e="$T/wi/new/deep" r=0 b
    rm -rf "$d" && printf '#!/bin/sh\ncase "$1" in */new) mkdir -p "$2/partial/inner" && touch "$2/partial/inner/f" && chmod 000 "$2/partial"; exit 1 ;; esac\nexec /bin/mv "$@"\n' > "$T/wi/bin/mv" && chmod +x "$T/wi/bin/mv"
    wi "$d" && r=1
    [ "$r" = 0 ] && grep -q 'could not move the files into' "$T/wi/out" && grep -qF "A half-moved copy is left at $(cd "$T/wi" && pwd -P)/stuck" "$T/wi/out" && [ -d "$d/partial" ] && ! ls -d "$T/wi/.dewfpga-backup."* >/dev/null 2>&1 || r=1
    chmod -R u+rwx "$d" 2>/dev/null; rm -rf "$d" "$T/wi"/.dewfpga-backup.*
    if [ "$r" = 0 ]; then
        echo old > "$e/old.txt"; wi "$e" && r=1
        b=$(ls -d "$T/wi/new"/.dewfpga-backup.* 2>/dev/null) || b=
        [ "$r" = 0 ] && grep -q 'nor the earlier install back; it is in' "$T/wi/out" && grep -q 'A half-moved copy is left at' "$T/wi/out" && [ -d "$e/partial" ] \
        && [ -n "$b" ] && [ "$(wc -l <<< "$b")" -eq 1 ] && [ "$(cat "$b/old/old.txt")" = old ] && [ -f "$b/old/bin/dewfpga" ] || r=1
        chmod -R u+rwx "$e" 2>/dev/null; rm -rf "$e"
        if [ -n "$b" ] && [ -d "$b/old" ]; then mv "$b/old" "$e" && rmdir "$b"; fi
    fi
    rm -f "$T/wi/bin/mv"; [ "$r" = 0 ]
}
check "web installer: the move fails halfway and the half-moved copy cannot be removed -> says so and names it; over an earlier install that one is whole in the folder named" wi_stuck
check "web installer: sha256 mismatch -> stops, the install in place stays" "echo x >> '$T/wi/site/dewfpga.tgz' && ! wi '$T/wi/new/deep' && grep -q 'sha256 mismatch' '$T/wi/out' && [ -f '$T/wi/new/deep/bin/dewfpga' ]"
# a developer's clone of the repo has bin/dewfpga and package.json like an install, and .git (a file in a worktree) with work in it
wi_clone() {
    rm -rf "$T/wi/clone" && mkdir -p "$T/wi/clone/bin" "$T/wi/clone/.git" && echo stub > "$T/wi/clone/bin/dewfpga" && cp "$T/wi/rel/dewfpga/package.json" "$T/wi/clone/" && echo wip > "$T/wi/clone/lab.sv" \
    && ! wi "$T/wi/clone" && grep -q 'git clone' "$T/wi/out" && [ -d "$T/wi/clone/.git" ] && [ "$(cat "$T/wi/clone/lab.sv")" = wip ] \
    && rmdir "$T/wi/clone/.git" && echo 'gitdir: /elsewhere/.git/worktrees/x' > "$T/wi/clone/.git" \
    && ! wi "$T/wi/clone" && grep -q 'git clone' "$T/wi/out" && [ -f "$T/wi/clone/.git" ] && [ "$(cat "$T/wi/clone/lab.sv")" = wip ]
}
check "web installer: refuses a git clone of dewfpga (.git folder, or a worktree's .git file), keeps it" wi_clone
# `nope/..` past a folder that does not exist: mkdir -p makes nope, and the path then names HOME or Documents
wi_dotdot() {
    mkdir -p "$T/wi/home/Documents" && echo keep > "$T/wi/home/Documents/cv.txt" \
    && ! wi "$T/wi/home/nope/../Documents" && grep -q 'does not exist yet' "$T/wi/out" \
    && ! wi "$T/wi/home/nope/../../home" && grep -q 'does not exist yet' "$T/wi/out" \
    && [ "$(cat "$T/wi/home/Documents/cv.txt")" = keep ] && [ -f "$T/wi/home/mine.txt" ] && [ ! -e "$T/wi/home/nope" ] && ! ls -d "$T/wi/.dewfpga-backup."* >/dev/null 2>&1
}
check "web installer: refuses a .. after a folder that does not exist yet, keeps HOME and its folders" wi_dotdot
# a folder on the way it cannot open: the path must not fall back to the part after it (an absolute path somewhere else)
wi_locked() {
    local r=0; rm -rf "$T/wi/victim" && mkdir -p "$T/wi/locked" "$T/wi/victim" && echo keep > "$T/wi/victim/lab.sv" && chmod 000 "$T/wi/locked"
    wi "$T/wi/locked$T/wi/victim" && r=1; chmod 755 "$T/wi/locked"
    [ "$r" = 0 ] && grep -q 'cannot be opened' "$T/wi/out" && [ "$(cat "$T/wi/victim/lab.sv")" = keep ] && [ ! -e "$T/wi/victim/bin" ]
}
check "web installer: a folder on the way it cannot open -> stops, replaces nothing elsewhere" wi_locked
# //HOME (bash's pwd keeps the double slash) and HOME in other letters (APFS ignores case) are HOME
wi_alias() {
    local up; up=$(printf '%s' "$T/wi/home" | tr '[:lower:]' '[:upper:]')
    ! wi "/$T/wi/home" && grep -q 'refusing' "$T/wi/out" && ! wi "/$T/wi" && grep -q 'parent of your home folder' "$T/wi/out" \
    && { [ ! "$up" -ef "$T/wi/home" ] || { ! wi "$up" && grep -q 'refusing' "$T/wi/out"; }; } && [ -f "$T/wi/home/mine.txt" ]
}
check "web installer: refuses //HOME, //parent of HOME and HOME in other letters" wi_alias
# uninstall from ~/.dewfpga: the web installer's folder goes; a link there to a developer's clone goes, the clone stays
# shellcheck disable=SC2031  # PATH here is this shell's own, wi's export never reached it
un_dewdir() {
    local h="$T/udh" c="$T/uclone"
    rm -rf "$h" "$c" && mkdir -p "$h/fpga" "$c/.git" && cp -R "$ROOT/bin" "$ROOT/package.json" "$c/" && echo wip > "$c/lab.sv" && ln -s "$c" "$h/.dewfpga" \
    && ln -sfn "$c/bin/dewfpga" "$T/wi/brew/bin/dewfpga" \
    && HOME="$h" FPGA_HOME="$h/fpga" PATH="$T/wi/bin:$PATH" "$T/wi/brew/bin/dewfpga" uninstall >"$T/un.out" 2>&1 \
    && [ ! -L "$h/.dewfpga" ] && [ ! -L "$T/wi/brew/bin/dewfpga" ] && [ -d "$c/.git" ] && [ "$(cat "$c/lab.sv")" = wip ] && [ -f "$c/bin/dewfpga" ] \
    && rm -rf "$c/.git" && mv "$c" "$h/.dewfpga" \
    && HOME="$h" FPGA_HOME="$h/fpga" PATH="$T/wi/bin:$PATH" "$h/.dewfpga/bin/dewfpga" uninstall >"$T/un.out" 2>&1 \
    && grep "^removing: .*/udh/.dewfpga$" "$T/un.out" >/dev/null && [ ! -e "$h/.dewfpga" ]
}
check "uninstall from ~/.dewfpga: removes the installer's folder; a link to a git clone goes, the clone stays" un_dewdir
# ~/.dewfpga itself a developer's clone, uninstall run through brew's link to it: the link goes, the clone stays (also with a dangling .git link)
# shellcheck disable=SC2031  # PATH here is this shell's own, wi's export never reached it
un_clone() {
    local h="$T/uch" c="$T/uch/.dewfpga"
    rm -rf "$h" && mkdir -p "$h/fpga" "$c/.git" && cp -R "$ROOT/bin" "$ROOT/package.json" "$c/" && echo wip > "$c/lab.sv" \
    && ln -sfn "$c/bin/dewfpga" "$T/wi/brew/bin/dewfpga" \
    && HOME="$h" FPGA_HOME="$h/fpga" PATH="$T/wi/bin:$PATH" "$T/wi/brew/bin/dewfpga" uninstall >"$T/un.out" 2>&1 \
    && [ ! -L "$T/wi/brew/bin/dewfpga" ] && [ -d "$c/.git" ] && [ "$(cat "$c/lab.sv")" = wip ] && [ -f "$c/bin/dewfpga" ] \
    && rmdir "$c/.git" && ln -s "$T/nowhere" "$c/.git" \
    && HOME="$h" FPGA_HOME="$h/fpga" PATH="$T/wi/bin:$PATH" "$c/bin/dewfpga" uninstall >"$T/un.out" 2>&1 \
    && [ -L "$c/.git" ] && [ "$(cat "$c/lab.sv")" = wip ]
}
check "uninstall: ~/.dewfpga a git clone, run through brew's link -> the link goes, the clone stays" un_clone
# //HOME and HOME in other letters name HOME; a string compare let them through and ~/venv went
un_alias() {
    local h="$T/uah" up; up=$(printf '%s' "$T/uah" | tr '[:lower:]' '[:upper:]')
    rm -rf "$h" && mkdir -p "$h/venv" "$h/chipdb" "$h/x" \
    && ! HOME="$h" FPGA_HOME="/$h" say "$CLI" uninstall && grep -q 'ERROR \[fpga-home-unsafe\]' "$T/say" \
    && ! HOME="$h/x" FPGA_HOME="/$h" say "$CLI" uninstall && grep -q 'parent of your home folder' "$T/say" \
    && { [ ! "$up" -ef "$h" ] || { ! HOME="$h" FPGA_HOME="$up" say "$CLI" uninstall && grep -q 'ERROR \[fpga-home-unsafe\]' "$T/say"; }; } \
    && [ -d "$h/venv" ] && [ -d "$h/chipdb" ]
}
check "uninstall refuses //HOME, //parent of HOME and HOME in other letters" un_alias
check "uninstall with a HOME that cannot be opened -> refuses, deletes nothing" "mkdir -p '$T/unh/venv' && ! HOME='$T/nowhere' FPGA_HOME='$T/unh' say '$CLI' uninstall && grep -q 'ERROR \[fpga-home-unsafe\]: HOME=$T/nowhere cannot be opened' '$T/say' && [ -d '$T/unh/venv' ]"
check "corrupt .fasm -> error, no .frames" "cd '$T/w' && '$CLI' clean && '$CLI' bit >/dev/null && sleep 1.1 && echo garbage > blink.fasm && ! '$CLI' bit >out 2>&1 && grep -q 'no FASM features' out"
check "port missing in xdc"   "cd '$T/w' && sed '/led\[15\]/d' blink.xdc > bad.xdc && cp blink.sv b.sv && mkdir x && mv b.sv x/blink.sv && cp bad.xdc x/blink.xdc && cd x && { '$CLI' bit || true; } 2>&1 | grep -q 'led\[15\]'"
check "install: refuses sudo" "mkdir -p '$T/fb' && printf '#!/bin/sh\n[ \"\$1\" = -u ] && echo 0 || /usr/bin/id \"\$@\"\n' > '$T/fb/id' && chmod +x '$T/fb/id' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'sudo'"
check "install: refuses x86"  "rm -f '$T/fb/id'; printf '#!/bin/sh\n[ \"\$1\" = -m ] && echo x86_64 || /usr/bin/uname \"\$@\"\n' > '$T/fb/uname' && chmod +x '$T/fb/uname' && { PATH='$T/fb':\$PATH FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'arm64'"
# install.sh step 0 looks for brew where brew.sh puts it before saying "Homebrew missing"; DEWFPGA_BREW_PATHS points it at
# stubs here, PATH is cut to the system dirs so the Mac's real brew is not found. Three Macs: no Homebrew, Homebrew in
# /opt/homebrew that was never put on the PATH (the message must name it and its echo line, pasted, must make brew
# resolvable), an Intel Homebrew in /usr/local.
install_brew_diag() {
    local d="$T/bd" out
    rm -rf "$d"; mkdir -p "$d/as/opt/homebrew/bin" "$d/intel/usr/local/bin" "$d/home"
    printf '#!/bin/sh\n: > "%s"\nexit 77\n' "$d/invoked" > "$d/as/opt/homebrew/bin/brew"; cp "$d/as/opt/homebrew/bin/brew" "$d/intel/usr/local/bin/brew"
    chmod +x "$d/as/opt/homebrew/bin/brew" "$d/intel/usr/local/bin/brew"
    run() { out=$( { PATH=/usr/bin:/bin FPGA_HOME="$T/e" DEWFPGA_BREW_PATHS="$1" "$ROOT/install.sh" || true; } 2>&1 ); }
    run "$d/none/opt/homebrew/bin/brew $d/none/usr/local/bin/brew"
    grep -q 'ERROR: Homebrew missing' <<< "$out" || { echo "no brew: $out"; return 1; }
    run "$d/as/opt/homebrew/bin/brew $d/intel/usr/local/bin/brew"
    grep -q "Homebrew is installed ($d/as/opt/homebrew/bin/brew) but not on your PATH" <<< "$out" || { echo "brew off PATH: $out"; return 1; }
    grep -q 'Homebrew missing' <<< "$out" && { echo "brew off PATH still says missing: $out"; return 1; }
    # the echo line it prints, pasted as is, must leave a .zprofile that makes brew resolvable
    local line; line=$(grep "zprofile" <<< "$out")
    (cd "$d/home" && HOME="$d/home" /bin/sh -c "$line") || { echo "echo line failed: $line"; return 1; }
    grep -qx "export PATH=\"$d/as/opt/homebrew/bin:\$PATH\"" "$d/home/.zprofile" || { echo ".zprofile got: $(cat "$d/home/.zprofile")"; return 1; }
    [ "$(PATH=/usr/bin:/bin /bin/sh -c '. '"$d"'/home/.zprofile && command -v brew')" = "$d/as/opt/homebrew/bin/brew" ] || { echo "brew not resolvable after .zprofile"; return 1; }
    run "$d/intel/usr/local/bin/brew"
    grep -q "Intel Homebrew was found at $d/intel/usr/local/bin/brew" <<< "$out" || { echo "intel brew: $out"; return 1; }
    out=$( { PATH="$d/intel/usr/local/bin:/usr/bin:/bin" HOME="$d/home" FPGA_HOME="$T/e" DEWFPGA_URL="file://$d/nosite" DEWFPGA_BREW_PATHS="$d/as/opt/homebrew/bin/brew" "$ROOT/install.sh" || true; } 2>&1 )
    grep -q "brew command on your PATH is $d/intel/usr/local/bin/brew" <<< "$out" || { echo "Intel brew on PATH: $out"; return 1; }
    [ ! -e "$d/invoked" ] || { echo "a brew candidate was executed during diagnosis"; return 1; }
}
check "install: brew absent, brew off the PATH and Intel brew get three different messages" install_brew_diag
check "install: no network -> clear error" "rm -rf '$T/e'; { GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=http://127.0.0.1:9 FPGA_HOME='$T/e' '$ROOT/install.sh' || true; } 2>&1 | grep -q 'could not fetch'"
check "install: idempotent (<10 s)" "s=\$(date +%s); '$ROOT/install.sh' >/dev/null 2>&1 && [ \$(( \$(date +%s) - s )) -lt 10 ]"

sec "== project template"
check "new + dewfpga bit"     "'$CLI' new '$T/p' && cd '$T/p' && '$CLI' bit && [ -s blink.bit ]"
# agents_md <dir>: the guidance new writes for a coding agent. A subshell, so a failed step cannot exit run.sh (check evals).
# Every `dewfpga <cmd>` it names (code block or backticks) is a label of the CLI's dispatch case, every --option is one the
# CLI or the JSON wrapper reads, the exit table matches agent_json.py, and the code block's tops and sim --json run as written
agents_md() { (
    set -e; cd "$1"
    [ "$(cat CLAUDE.md)" = '@AGENTS.md' ]; cmp -s AGENTS.md "$ROOT/templates/AGENTS.md"; [ "$(wc -l < AGENTS.md)" -le 60 ]
    labels=$(sed -n '/^case "${1:-}" in/,/^esac/p' "$ROOT/bin/dewfpga" | sed -nE 's/^ +([a-z|-]+)\).*/\1/p' | tr '|' '\n')
    named=$( { awk '/^```/{f=!f; next} f && $1=="dewfpga"{print $2}' AGENTS.md; grep -oE '`dewfpga [a-z]+' AGENTS.md | cut -d' ' -f2; } | sort -u)
    [ -n "$named" ]
    for w in $named; do grep -qx -- "$w" <<< "$labels" || { echo "AGENTS.md names dewfpga $w, bin/dewfpga has no such command"; false; }; done
    grep -oE -- '--[a-z][a-z-]*' AGENTS.md | sort -u | while read -r o; do
        grep -q -- "$o" "$ROOT/bin/dewfpga" "$ROOT/templates/agent_json.py" || { echo "AGENTS.md names $o, the CLI does not read it"; false; }; done
    python3 -B - "$ROOT/templates/agent_json.py" AGENTS.md <<'EOF'
import re, sys
src, doc = open(sys.argv[1]).read(), open(sys.argv[2]).read()
table = {int(n) for n in re.findall(r"^\| (\d+) \|", doc, re.M)}
real = {0} | {int(n) for n in re.findall(r"\b(\d+)\b", src[src.index("EXIT_FOR_CODE"):src.index("SITE =")])}
assert table and table <= real, f"exit table {sorted(table)} vs agent_json.py {sorted(real)}"
EOF
    "$CLI" tops | grep -q '^blink'
    "$CLI" sim --json > "$T/agents.json"
    python3 -B -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["schema"]=="dewfpga/result@1" and r["ok"] is True and r["exit_code"]==0, r' "$T/agents.json"
) }
check "new: AGENTS.md + CLAUDE.md for a coding agent (CLAUDE.md is the one-line import; every command, option and exit code it names is the CLI's; tops and sim --json run)" "agents_md '$T/p'"
check "new: no Makefile, task uses dewfpga" "cd '$T/p' && [ ! -e Makefile ] && grep -q '\"dewfpga flash\"' .vscode/tasks.json && ! grep -q 'make ' .vscode/tasks.json && python3 -c 'import json;json.load(open(\".vscode/settings.json\"));json.load(open(\".vscode/extensions.json\"))'"
check "manual path: templates/Makefile"  "mkdir '$T/mk' && cp '$ROOT'/templates/{blink.sv,blink_tb.sv,blink.xdc,check_xdc.py,Makefile} '$T/mk/' && cd '$T/mk' && make -s bit > out.txt && grep -q '^pnr ok' out.txt && [ -s blink.bit ] && ! make check | grep -q MISSING"

sec "== rebuild rules (.deps, #3): a changed include or .mem rebuilds and changes the bitstream; a renamed testbench recompiles"
uptodate() { [ "$("$CLI" bit 2>&1)" = "$1.bit is up to date (nothing changed since the last build; dewfpga clean forces a rebuild)" ]; }
# the LED constant comes from defs.svh: its change has to reach the .bit (compared byte for byte, and the .frames)
# shellcheck disable=SC2016   # `include and `VAL are Verilog
inc_rebuild() {
    mkdir -p "$T/inc" && cd "$T/inc" && printf '`define VAL 8'"'"'h3C\n' > defs.svh \
    && printf '`include "defs.svh"\nmodule top(input logic [15:0] sw, output logic [15:0] led);\n  assign led = {sw[7:0], `VAL};\nendmodule\n' > top.sv \
    && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > top.xdc \
    && "$CLI" bit > out 2>&1 && [ -s top.bit ] && cp top.bit a.bit && cp top.frames a.frames && uptodate top \
    && printf '`define VAL 8'"'"'hC3\n' > defs.svh && "$CLI" bit > out2 2>&1 && grep -q '^pnr ok' out2 && ! cmp -s a.frames top.frames && ! cmp -s a.bit top.bit
}
check "a changed .svh include rebuilds, and the .bit differs" inc_rebuild
# a $readmemh ROM: the first row of rom.mem changes, and the .bit has to change with it
# shellcheck disable=SC2016   # $readmemh is Verilog
mem_rebuild() {
    mkdir -p "$T/mem" && cd "$T/mem" && printf '3C\nA5\n0F\n' > rom.mem \
    && printf 'module top(input logic clk, input logic [15:0] sw, output logic [15:0] led);\n  logic [7:0] rom [0:3];\n  initial $readmemh("rom.mem", rom);\n  logic [7:0] q;\n  always_ff @(posedge clk) q <= rom[sw[1:0]];\n  assign led = {rom[sw[3:2]], q};\nendmodule\n' > top.sv \
    && sed 's/blink/top/' "$ROOT/templates/blink.xdc" > top.xdc \
    && "$CLI" bit > out 2>&1 && [ -s top.bit ] && cp top.bit a.bit && cp top.frames a.frames && uptodate top \
    && printf 'FF\nA5\n0F\n' > rom.mem && "$CLI" bit > out2 2>&1 && grep -q '^pnr ok' out2 && ! cmp -s a.frames top.frames && ! cmp -s a.bit top.bit
}
check "a changed .mem rebuilds, and the .bit differs" mem_rebuild
# the sleep: make 3.81 compares whole seconds, so a testbench renamed within the second of the last compile is
# not seen as newer (5 of 6 runs of this check without the sleep ran the stale blink_sim); a student is slower than that
tb_rename() {
    mkdir -p "$T/tbr" && cp "$ROOT"/templates/{blink.sv,blink_tb.sv} "$T/tbr/" && cd "$T/tbr" \
    && "$CLI" sim > out 2>&1 && grep -q '^iverilog -g2012 -o blink_sim blink.sv blink_tb.sv$' out \
    && "$CLI" sim > out2 2>&1 && ! grep -q '^iverilog' out2 \
    && sleep 1.1 && mv blink_tb.sv bench.sv && "$CLI" sim > out3 2>&1 && grep -q '^iverilog -g2012 -o blink_sim blink.sv bench.sv$' out3 && grep -q '^PASS: 3 checks' out3
}
check "a renamed testbench recompiles (the second sim did not)" tb_rename
# #29: Apple's make 3.81 compares whole seconds (an edit 0.4 s after the build: 0 of 5 rebuilt), so a testbench
# saved within the second of the last compile (VS Code: save, ⌘⇧B) ran the old blink_sim and printed its old PASS.
# The .deps files carry a checksum of the content now. touch puts the compiled file and the edit in the second the
# rebuild starts in (make rewrites the .deps file then too, so it is not newer either): the worst case, and the one
# the report reproduced with touch -r. For bit that second is one the build is still running in (the netlist is
# written seconds before the .bit), so the netlist is dated the same way
# shellcheck disable=SC2016   # $finish and $error are Verilog
same_second_sim() {
    mkdir -p "$T/same_second_sim" && cp "$ROOT"/templates/{blink.sv,blink_tb.sv} "$T/same_second_sim/" && cd "$T/same_second_sim" \
    && "$CLI" sim > out 2>&1 && grep -q '^PASS: 3 checks' out \
    && sed -i '' 's/\$finish;/$error("planted"); $finish;/' blink_tb.sv && touch blink_sim blink_tb.sv \
    && ! "$CLI" sim > out2 2>&1 && grep -q '^iverilog' out2 && [ "$(grep -c planted blink_sim.out)" -eq 1 ] && grep -q 'ERROR \[testbench-error\]' out2
}
check "a testbench edited within the second of the last compile recompiles (make 3.81 compares whole seconds)" same_second_sim
same_second_bit() {
    mkdir -p "$T/same_second_bit" && cp "$ROOT"/templates/{blink.sv,blink.xdc} "$T/same_second_bit/" && cd "$T/same_second_bit" \
    && "$CLI" bit > out 2>&1 && [ -s blink.bit ] && cp blink.frames a.frames && uptodate blink \
    && sed -i '' 's/assign led = {sw\[0\],/assign led = {sw[1],/' blink.sv && touch blink.json blink.sv \
    && "$CLI" bit > out2 2>&1 && grep -q '^pnr ok' out2 && ! cmp -s a.frames blink.frames
}
check "a design edited within the second of the last synthesis rebuilds, and the .frames differ" same_second_bit
# led[0] and led[1] swap pads: the same two pads are used, so the IOB lines stay and the routing (the .frames) changes
same_second_xdc() {
    cd "$T/same_second_bit" && cp blink.frames b.frames && uptodate blink \
    && sed -i '' 's/PACKAGE_PIN U16 /PACKAGE_PIN TMP /; s/PACKAGE_PIN E19 /PACKAGE_PIN U16 /; s/PACKAGE_PIN TMP /PACKAGE_PIN E19 /' blink.xdc && touch -r blink.fasm blink.xdc \
    && "$CLI" bit > out3 2>&1 && grep -q '^pnr ok' out3 && ! cmp -s b.frames blink.frames
}
check "an XDC edited within the second of the last place-and-route re-places, and the .frames differ" same_second_xdc

# ---------------------------------------------------------------------------------------------------- #6B
# test/bit-check.sh reads a .bit back (the sync word, the type 1/2 packets, the FDRI data cut into 101-word
# frames and given their addresses by part.yaml's walk) and compares every frame with what fasm2frames makes
# of the .fasm. It runs on the blink the template built ($T/p) and has to refuse the .fasm of another design
# ($T/ui, a sw -> led design), a .bit cut in half, and a .bit with one bit flipped inside a used frame.
sec "== inside the bitstream, and the board"
BC="$ROOT/test/bit-check.sh"
# under ONLY=regex the checks 'new + dewfpga bit' ($T/p) and 'unnamed instance' ($T/ui) may not have run: built here then
need_p()  { [ -s "$T/p/blink.bit" ] || { rm -rf "$T/p" && "$CLI" new "$T/p" > /dev/null && cd "$T/p" && "$CLI" bit > /dev/null; }; }
need_ui() { [ -s "$T/ui/ui.fasm" ] || ui_build; }
bc_flip() {   # $T/flip.bit: $T/p/blink.bit with one bit flipped in the first non-zero word 2000 bytes past the sync word
    python3 - "$T/p/blink.bit" "$T/flip.bit" <<'PY'
import sys
b = bytearray(open(sys.argv[1], "rb").read()); i = b.find(b"\xaa\x99\x55\x66") + 4 + 2000
while b[i] == 0: i += 4
b[i] ^= 0x40; open(sys.argv[2], "wb").write(b)
PY
}
# each check runs the product through say, so a FAIL shows the lines it printed (bit-check.sh's ERROR line,
# openFPGALoader's message and the product's ERROR line), not a bare FAIL
check "blink.bit holds the frames of blink.fasm (read back from the .bit)" "need_p && say '$BC' '$T/p/blink.bit' '$T/p/blink.fasm' && grep -q '^bit ok: .* non-zero' '$T/say'"
check "blink.bit holds the frames of blink.frames"                        "need_p && say '$BC' '$T/p/blink.bit' '$T/p/blink.frames' && grep -q '^bit ok' '$T/say'"
check "blink.bit with another design's fasm is refused"                   "need_p && need_ui && ! say '$BC' '$T/p/blink.bit' '$T/ui/ui.fasm' && grep -q 'ERROR \[bit-check\]: .*frames differ' '$T/say'"
check "a .bit cut in half is refused"                                      "need_p && head -c \$(( \$(stat -f%z '$T/p/blink.bit') / 2 )) '$T/p/blink.bit' > '$T/half.bit' && ! say '$BC' '$T/half.bit' '$T/p/blink.fasm' && grep -q 'ERROR \[bit-check\]: .*truncated' '$T/say'"
check "a .bit with one bit flipped in a used frame is refused"            "need_p && bc_flip && ! say '$BC' '$T/flip.bit' '$T/p/blink.fasm' && grep -q '1 of [0-9]* frames differ' '$T/say'"
# the board. Without one, dewfpga flash has to stop with the board-not-found line and no make trailer. With a
# Basys3 on USB (system_profiler lists Digilent), dewfpga flash programs blink into it (SRAM, gone at power
# off) and openFPGALoader's own success line, Done, has to be in the output, with exit 0 and no ERROR line.
# All four checks are listed on every machine (--list prints one number everywhere, with or without a board);
# the ones this machine cannot run print a SKIP line.
if [ "$LIST" = 1 ] || system_profiler SPUSBDataType 2>/dev/null | grep -q 'Digilent'; then
check "flash on the board: openFPGALoader programs it (its Done line)" "need_p && cd '$T/p' && { say '$CLI' flash || true; } && grep -q 'Done' '$T/say'"
check "flash on the board: exit 0, no ERROR line"                     "need_p && cd '$T/p' && say '$CLI' flash && ! grep -q 'ERROR \[' '$T/say'"
[ "$LIST" = 1 ] || echo "  SKIP flash w/o board (2 checks): a Basys3 is on USB"
fi
if [ "$LIST" = 1 ] || ! system_profiler SPUSBDataType 2>/dev/null | grep -q 'Digilent'; then
check "flash w/o board: board-not-found line, exit 1" "need_p && cd '$T/p' && ! say '$CLI' flash && grep -q 'ERROR \[board-not-found\]: board not found' '$T/say'"
check "flash w/o board: no make trailer"              "need_p && cd '$T/p' && { say '$CLI' flash || true; } && ! grep -q 'make: \*\*\*' '$T/say'"
[ "$LIST" = 1 ] || echo "  SKIP flash on the board: no board: plug the Basys3 in and run test/run.sh again"
fi
# ---------------------------------------------------------------------------------------------------- #6B

# sv_rows <rows> <runner exit code> <runner log> [expect.tsv]: one PASS, GAP or FAIL per row of test/sv/run.sh's SV_OUT.
# The verdict is worked out again from expect.tsv and the row's four stages: bad when a stage that should
# pass did not (with the measured yosys and iverilog: when any stage differs), or when a bitstream builds from
# a netlist that fails and expect.tsv does not say so; else gap when Vivado supports the construct and a
# stage fails, or when the bitstream builds from a netlist that fails; else ok. The runner may find more
# (a file:line the today column quotes and no stage printed), never less.
sv_rows() {
    local rows=$1 rc=$2 log=$3 exp=${4:-$ROOT/test/sv/expect.tsv} id v rtl syn net bit msg viv e_rtl e_syn e_net e_bit exact=1 want s nbad=0 ngap=0 said
    local cn=0 csyn=0 call=0 csup=0 csupall=0 score
    [ "$(yosys -V | awk '{print $2}')" = "$(cat "$ROOT/test/golden/yosys-version")" ] && [ "$(iverilog -V 2>&1 | awk 'NR==1{print $4}')" = 13.0 ] || exact=0
    while IFS=$'\t' read -r id v rtl syn net bit msg; do
        IFS=$'\t' read -r viv e_rtl e_syn e_net e_bit <<< "$(awk -F'\t' -v id="$id" 'NR>1 && $1==id{print $3"\t"$5"\t"$6"\t"$7"\t"$8}' "$exp")"
        # the score line, counted again from the rows: synthesis, all four stages, supported and all four
        cn=$((cn+1)); [ "$syn" = pass ] && csyn=$((csyn+1)); [ "$viv" = supported ] && csup=$((csup+1))
        if [ "$rtl$syn$net$bit" = passpasspasspass ]; then call=$((call+1)); [ "$viv" = supported ] && csupall=$((csupall+1)); fi
        want=ok
        if [ -z "$viv" ]; then want=bad
        else
            for s in "$rtl:$e_rtl" "$syn:$e_syn" "$net:$e_net" "$bit:$e_bit"; do
                [ "${s%%:*}" = "${s#*:}" ] || { [ $exact = 0 ] && [ "${s#*:}" != pass ]; } || want=bad
            done
            [ "$bit/$net" = pass/fail ] && [ "$e_bit/$e_net" != pass/fail ] && want=bad
            if [ $want = ok ] && { { [ "$viv" = supported ] && [ "$rtl$syn$net$bit" != passpasspasspass ]; } || [ "$bit/$net" = pass/fail ]; }; then want=gap; fi
        fi
        if [ "$v" = bad ]; then
            nbad=$((nbad+1)); bad "sv $id: $msg"; awk -v id="$id" '$1=="BAD" && $2==id {f=1; next} f && /^         / {print "  " $0; next} {f=0}' "$log"
        elif [ "$v" != ok ] && [ "$v" != gap ]; then
            nbad=$((nbad+1)); bad "sv $id: the runner's verdict is '$v', not ok, gap or bad"
        elif [ "$v" != "$want" ]; then
            s="its vivado column ($viv) and stages (rtl $rtl, synth $syn, netlist $net, bit $bit) make it $want"
            [ "$want" != bad ] || s="its stages (rtl $rtl, synth $syn, netlist $net, bit $bit) differ from expect.tsv (rtl $e_rtl, synth $e_syn, netlist $e_net, bit $e_bit)"
            bad "sv $id: the runner says $v, but $s"
        elif [ "$v" = ok ]; then ok "sv $id: rtl $rtl, synth $syn, netlist $net, bit $bit${msg:+ ($msg)}"
        else ngap=$((ngap+1)); gap "sv $id: rtl $rtl, synth $syn, netlist $net, bit $bit${msg:+ ($msg)}"; fi
    done < "$rows"
    # the runner's exit code, and its own gap count, have to agree with its rows
    if [ "$rc" -ne 0 ] && [ $nbad -eq 0 ]; then bad "sv: test/sv/run.sh exited $rc but no row says BAD"; tail -3 "$log" | sed 's/^/       /'; fi
    if [ "$rc" -eq 0 ] && [ $nbad -gt 0 ]; then bad "sv: test/sv/run.sh exited 0 with $nbad BAD rows"; fi
    # and so does its score line, the before -> after number of #3 and #4, which it has to print
    said=$(grep -E '^synthesis ' "$log" || true)
    score="synthesis $csyn/$cn, all four stages $call/$cn, Vivado-supported probes passing all four stages $csupall/$csup, known gaps $ngap"
    if [ -z "$said" ]; then bad "sv: test/sv/run.sh printed no score line, its rows make it '$score'"
    elif [ "$said" != "$score" ]; then bad "sv: test/sv/run.sh says '$said', its rows make it '$score'"; fi
}

sec "== probe runner (test/sv/run.sh on a copy, one probe each)"
# a copy of the product in which one thing is broken on purpose; each check runs one probe through it
svcopy() { rm -rf "$T/svr" && mkdir -p "$T/svr" && cp -R "$ROOT/bin" "$ROOT/templates" "$ROOT/test" "$ROOT/package.json" "$T/svr/" && { cp "$ROOT/.fpga_home" "$T/svr/" 2>/dev/null || true; }; }
setrow() { awk -F'\t' -v id="$1" -v c="$2" -v v="$3" 'BEGIN{OFS="\t"} $1==id{$c=v} {print}' "$T/svr/test/sv/expect.tsv" > "$T/svr/x" && mv "$T/svr/x" "$T/svr/test/sv/expect.tsv"; }
# the copies run without CI's GITHUB_STEP_SUMMARY and SV_OUT: only the real run below reports its score
svrun() { ! env -u GITHUB_STEP_SUMMARY -u SV_OUT "$T/svr/test/sv/run.sh" "$1" > "$T/svr/out" 2>&1; }      # the run has to fail
# 09's design broken, and a stale top_sim that prints PASS left next to it
# shellcheck disable=SC2016   # $display and $finish are Verilog
st_stale() {
    svcopy && echo 'garbage;' >> "$T/svr/test/sv/09_always_procs/design.sv" \
    && printf 'module tb; initial begin $display("PASS"); $finish; end endmodule\n' > "$T/svr/stale.sv" \
    && iverilog -o "$T/svr/test/sv/09_always_procs/top_sim" "$T/svr/stale.sv" \
    && svrun 09_always_procs && grep -qE 'BAD +09_always_procs +rtl fail' "$T/svr/out"
}
# 97 recorded as refused, under a yosys that is not the measured one: it builds a bitstream and its netlist fails
# (05 was the case until #3 made the product refuse it)
st_silent() {
    svcopy && echo 0.0-other > "$T/svr/test/golden/yosys-version" \
    && setrow 97_ram_style_block 6 fail && setrow 97_ram_style_block 7 - && setrow 97_ram_style_block 8 fail \
    && svrun 97_ram_style_block && grep -q 'a new silent wrong' "$T/svr/out"
}
st_unexpected() { svcopy && setrow 07_enum_packed_array 7 fail && svrun 07_enum_packed_array && grep -q 'netlist pass, expected fail' "$T/svr/out"; }
st_nosource()   { svcopy && setrow 26_inst_array 4 '' && svrun 26_inst_array && grep -q 'malformed rows' "$T/svr/out"; }
# a vivado value spelled another way ('Supported') would count 01 neither as supported nor as a gap
st_vivvalue()   { svcopy && setrow 01_latch_comb 3 Supported && svrun 01_latch_comb && grep -q 'malformed rows' "$T/svr/out"; }
# the CLI's latch error made to name line 1 instead of the always_comb line (design.sv:3)
st_latchline() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "sub(/\\$$[0-9]+.*/,\"\",at);"
assert old in s, "the latch rule moved; update this check"
open(p, "w").write(s.replace(old, old + " sub(/:[0-9]+/,\":1\",at);", 1))' "$T/svr/templates/Makefile" \
    && svrun 01_latch_comb && grep -q 'says design.sv:3, no stage printed it' "$T/svr/out"
}
# the latch error's advice replaced: 01's today column quotes it, so the run has to miss the quote
st_latchtext() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "Vivado builds the latch too, with the same warning"
assert old in s, "the latch warning changed; update this check"
open(p, "w").write(s.replace(old, "something went wrong", 1))' "$T/svr/templates/Makefile" \
    && svrun 01_latch_comb && grep -qF "expect.tsv quotes 'design.sv:3: warning [latch]: latch inferred for q" "$T/svr/out" && grep -q 'no stage printed it' "$T/svr/out"
}
# the unnamed-instance fix replaced: 02's today column quotes it in "...", so the run has to miss the quote
st_fixtext() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "named the instance"
assert old in s, "the unnamed-instance note changed; update this check"
open(p, "w").write(s.replace(old, "did something:", 1))' "$T/svr/templates/check_xdc.py" \
    && svrun 02_unnamed_inst && grep -qF "expect.tsv quotes 'design.sv:5: note [unnamed-instance]: named the instance:" "$T/svr/out" && grep -q 'no stage printed it' "$T/svr/out"
}
# the CLI made to skip .v files: 74's design.v:3 then never prints, and only the today column's file:line says so
st_vfile() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "for f in *.sv *.v *.SV *.V; do"
assert old in s, "the CLI file loop changed; update this check"
open(p, "w").write(s.replace(old, "for f in *.sv *.SV; do", 1))' "$T/svr/bin/dewfpga" \
    && svrun 74_verilog2005_file && grep -q 'expect.tsv says design.v:3, no stage printed it' "$T/svr/out"
}
# 16c's design broken so its testbench prints FAIL; dewfpga sim still exits 0, and 16c's synthesis fails
# anyway, so only the runner's look at the testbench's own verdict can see it
st_tbfail() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "found = !sw[i];"
assert old in s, "16c changed; update this check"
open(p, "w").write(s.replace(old, "found = sw[i];", 1))' "$T/svr/test/sv/16c_while_loop/design.sv" \
    && svrun 16c_while_loop && grep -q 'rtl fail, expected pass' "$T/svr/out"
}
# 07's testbench made to report an $error and print PASS all the same: dewfpga sim exits 1, so only the rtl stage's
# exit code can see it (st_tbfail pins the other half, the PASS line)
# shellcheck disable=SC2016   # $error is Verilog
st_rtlexit() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "  initial begin #200000"
assert old in s, "07 changed; update this check"
open(p, "w").write(s.replace(old, "  initial #1 $error(\"planted error\");\n" + old, 1))' "$T/svr/test/sv/07_enum_packed_array/tb.sv" \
    && svrun 07_enum_packed_array && grep -qE 'BAD +07_enum_packed_array +rtl fail' "$T/svr/out"
}
# a probe folder with no row in expect.tsv would never run
st_folder() {
    svcopy && mkdir "$T/svr/test/sv/99_no_row" && cp "$T/svr/test/sv/07_enum_packed_array/"*.sv "$T/svr/test/sv/99_no_row/" \
    && svrun 07_enum_packed_array && grep -q 'folders and the rows' "$T/svr/out"
}
# the CLI made to exit 0 without leaving top.bit: the bit stage needs the file, not only the exit code
# shellcheck disable=SC2016   # $$ and $@ are make's
st_nobit() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "<<< \"$$(stat -f%z $@)\""
assert old in s, "the bit rule changed; update this check"
open(p, "w").write(s.replace(old, old + "; rm -f $@", 1))' "$T/svr/templates/Makefile" \
    && svrun 07_enum_packed_array && grep -q 'bit fail, expected pass' "$T/svr/out"
}
# 01 is a gap (Vivado builds it, we do not); a vivado column changed without its source must be refused
st_column() {
    svcopy && setrow 01_latch_comb 3 'not supported' && svrun 01_latch_comb && grep -q 'does not match its source' "$T/svr/out" \
    && svcopy && setrow 01_latch_comb 3 unverified && svrun 01_latch_comb && grep -q 'does not match its source' "$T/svr/out"
}
# a probe that stops doing what expect.tsv says has to turn this suite red, not only the runner:
# 14's parameterized instance hidden from the top finder, run through the runner, its rows read below
st_badrow() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "(\\s*#\\s*\\([^;]*?\\))?"
assert old in s, "the top finder changed; update this check"
open(p, "w").write(s.replace(old, "(NEVERMATCH)?", 1))' "$T/svr/templates/check_xdc.py" \
    && { rc=0; env -u GITHUB_STEP_SUMMARY SV_OUT="$T/svr/rows" "$T/svr/test/sv/run.sh" 14_params > "$T/svr/out" 2>&1 || rc=$?; } \
    && [ "$rc" -ne 0 ] && grep -q "^14_params$(printf '\t')bad$(printf '\t')" "$T/svr/rows" \
    && [ "$(svfails "$T/svr/rows" "$rc" "$T/svr/out")" -gt 0 ]
}
# the netlist stage's two halves, each pinned with a yosys that is not the measured one (as in CI), where a new
# pass is only a note: a design whose synthesized netlist differs from its RTL (`ifdef SYNTHESIS, which yosys
# defines and iverilog does not). 07 with a testbench that sees nothing: only the comparison with the RTL can
# catch it. 54, whose RTL iverilog cannot compile: only the testbench's FAIL on the netlist can catch it.
# shellcheck disable=SC2016   # `ifdef, $display and $finish are Verilog
st_eqvpin() {
    svcopy && echo 0.0-other > "$T/svr/test/golden/yosys-version" && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "  assign led = {12'"'"'d0, state};\n"
assert old in s, "07 changed; update this check"
open(p, "w").write(s.replace(old, "`ifdef SYNTHESIS\n  assign led = {12'"'"'d0, state ^ 4'"'"'b0001};\n`else\n" + old + "`endif\n", 1))' "$T/svr/test/sv/07_enum_packed_array/design.sv" \
    && printf 'module tb; reg clk = 0, btnC = 0; reg [15:0] sw = 0; wire [15:0] led;\n top dut(.clk(clk), .btnC(btnC), .sw(sw), .led(led));\n initial begin #1 $display("PASS"); $finish; end\nendmodule\n' > "$T/svr/test/sv/07_enum_packed_array/tb.sv" \
    && svrun 07_enum_packed_array && grep -q 'netlist fail, expected pass' "$T/svr/out"
}
# shellcheck disable=SC2016   # `ifdef is Verilog
st_nettb() {
    svcopy && echo 0.0-other > "$T/svr/test/golden/yosys-version" && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "  assign stop = sw[0] & sw[1];\n"
assert old in s, "54 changed; update this check"
open(p, "w").write(s.replace(old, "`ifdef SYNTHESIS\n  assign stop = sw[0] | sw[1];\n`else\n" + old + "`endif\n", 1))' "$T/svr/test/sv/54_use_before_decl/design.sv" \
    && svrun 54_use_before_decl && grep -q 'netlist fail, expected pass' "$T/svr/out"
}
# 04's second quote, the CLI's dual-edge advice, changed in the product: every quote of a row is looked for,
# not only the first (st_latchtext and st_fixtext change a row's only quote)
st_quote2() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "no flip-flop on the chip does that"
assert old in s, "the dual-edge advice changed; update this check"
open(p, "w").write(s.replace(old, "Use one edge.", 1))' "$T/svr/templates/Makefile" \
    && svrun 04_dual_edge && grep -qF "expect.tsv quotes 'no flip-flop on the chip does that, and neither reader builds it.', no stage printed it" "$T/svr/out"
}
# 76's second file:line made wrong in expect.tsv: every file:line of a row is looked for, not only the first
st_line2() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "and the same for eq (design.sv:6)"
assert old in s, "76 changed; update this check"
open(p, "w").write(s.replace(old, "and the same for eq (design.sv:9)", 1))' "$T/svr/test/sv/expect.tsv" \
    && svrun 76_implicit_net && grep -q 'expect.tsv says design.sv:9, no stage printed it' "$T/svr/out"
}
# 07's equivalence bench made not to compile, so eqv.sh exits 1: only exit 2 (iverilog cannot compile the RTL)
# may turn the comparison into a skip; any other failure of eqv.sh is a netlist fail
st_eqvexit() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "    L.append(\"endmodule\")\n    print("
assert old in s, "the end of the bench moved; update this check"
open(p, "w").write(s.replace(old, "    L.append(\"garbage;\")\n" + old, 1))' "$T/svr/test/sv/eqv.py" \
    && svrun 07_enum_packed_array && grep -q 'netlist fail, expected pass' "$T/svr/out"
}
# the same, from rows written by hand: a BAD verdict fails, and so do an ok or gap that the stages contradict
svfails() { sv_rows "$@" | grep -c '31mFAIL' || true; }       # how many FAIL lines sv_rows prints
# the same without the missing score line: the rows below come with no runner log
svrowfails() { sv_rows "$@" | grep '31mFAIL' | grep -vc 'printed no score line' || true; }
st_verdicts() {
    local r="$T/rows"
    printf '07_enum_packed_array\tbad\tpass\tpass\tpass\tpass\tsomething\n' > "$r"; [ "$(svrowfails "$r" 1 /dev/null)" -eq 1 ] || return 1
    [ "$(svrowfails "$r" 0 /dev/null)" -eq 2 ] || return 1       # the row, and an exit code 0 that does not fit it
    printf '07_enum_packed_array\tok\tpass\tfail\t-\tfail\t\n' > "$r";         [ "$(svrowfails "$r" 0 /dev/null)" -gt 0 ] || return 1
    printf '05_two_block_driver\tok\tpass\tpass\tfail\tpass\t\n' > "$r";        [ "$(svrowfails "$r" 0 /dev/null)" -gt 0 ] || return 1
    printf '01_latch_comb\tok\tpass\tfail\t-\tfail\t\n' > "$r";                 [ "$(svrowfails "$r" 0 /dev/null)" -gt 0 ] || return 1
    printf '07_enum_packed_array\tok\tpass\tpass\tpass\tpass\t\n' > "$r";      [ "$(svrowfails "$r" 1 /dev/null)" -gt 0 ] || return 1
    printf '07_enum_packed_array\tok\tpass\tpass\tpass\tpass\t\n' > "$r";      [ "$(svrowfails "$r" 0 /dev/null)" -eq 0 ]
}
# the score line has to be the one the rows make: 07 passes all four, 01 is a supported gap
st_score() {
    local r="$T/rows" l="$T/score.log" good='synthesis 1/2, all four stages 1/2, Vivado-supported probes passing all four stages 1/2, known gaps 1'
    printf '07_enum_packed_array\tok\tpass\tpass\tpass\tpass\t\n11_enum_methods\tgap\tpass\tfail\t-\tfail\t\n' > "$r"
    echo "$good" > "$l"; [ "$(svfails "$r" 0 "$l")" -eq 0 ] || return 1
    for s in "${good/1\/2, known/2\/2, known}" "${good/synthesis 1/synthesis 2}" "${good/stages 1\/2,/stages 2\/2,}" "${good/gaps 1/gaps 0}" "${good/synthesis/Synthesis}"; do
        echo "$s" > "$l"; [ "$(svfails "$r" 0 "$l")" -eq 1 ] || return 1
    done
    : > "$l"; [ "$(svfails "$r" 0 "$l")" -eq 1 ]           # no score line at all
}
# with the measured yosys and iverilog, a stage that passes where expect.tsv says fail is a FAIL even when the
# runner's row says ok: 07's netlist recorded as failing, a row that says all four passed
st_exact() {
    local r="$T/rows" x="$T/x.tsv"
    awk -F'\t' 'BEGIN{OFS="\t"} $1=="07_enum_packed_array"{$7="fail"} {print}' "$ROOT/test/sv/expect.tsv" > "$x"
    printf '07_enum_packed_array\tok\tpass\tpass\tpass\tpass\t\n' > "$r"; [ "$(svrowfails "$r" 0 /dev/null "$x")" -eq 1 ]
}
check "a build output left in a probe folder is not reused" st_stale
check "a new silent wrong fails with any yosys" st_silent
if [ "$LIST" = 1 ] || [ "$(yosys -V | awk '{print $2}')" = "$(cat "$ROOT/test/golden/yosys-version")" ]; then
check "an unexpected pass fails with the measured yosys" st_unexpected
check "an unexpected pass in a row is not trusted with the measured yosys" st_exact
else echo "  SKIP an unexpected pass fails: yosys $(yosys -V | awk '{print $2}') here, expect.tsv measured with $(cat "$ROOT/test/golden/yosys-version")"; fi
check "a row without a Vivado source is refused" st_nosource
check "a vivado value other than supported, not supported, unverified is refused" st_vivvalue
check "a wrong line in the latch error is caught" st_latchline
check "a testbench that prints FAIL is an rtl fail" st_tbfail
check "a testbench that prints PASS while dewfpga sim exits 1 is an rtl fail" st_rtlexit
check "a probe folder without a row is refused" st_folder
check "a bit run without top.bit is a bit fail" st_nobit
check "a vivado column its source does not back is refused" st_column
check "a probe that stops matching expect.tsv fails this suite" st_badrow
check "the verdict of each row is checked, not trusted" st_verdicts
check "the score line is counted again from the rows" st_score
check "a message the today column quotes is checked" st_latchtext
check "a message the today column quotes in double quotes is checked" st_fixtext
check "a file:line of a .v file is checked" st_vfile
check "a message the today column quotes second is checked" st_quote2
check "a file:line the today column names second is checked" st_line2
check "a comparison that fails with exit 1 is a netlist fail" st_eqvexit
check "a netlist that differs from its RTL fails, with any yosys" st_eqvpin
check "a testbench FAIL on the netlist fails, with any yosys" st_nettb
check "the runner checks leave CI's step summary alone" "GITHUB_STEP_SUMMARY='$T/summary.md' st_latchline && GITHUB_STEP_SUMMARY='$T/summary.md' st_badrow && [ ! -s '$T/summary.md' ]"
# eqv.py, the netlist stage's comparison with the RTL, on netlists that differ in one known way
check "eqv.py: an equal netlist passes" "'$ROOT/test/sv/eqv_check.sh' equal"
check "eqv.py: a fault only on led[15] is caught" "'$ROOT/test/sv/eqv_check.sh' msb"
check "eqv.py: a fault only at sw=0000 is caught" "'$ROOT/test/sv/eqv_check.sh' zero"
check "eqv.py: a fault only at sw=1234 is caught" "'$ROOT/test/sv/eqv_check.sh' walk"
check "eqv.py: a fault only while btnC is pressed, no clock, is caught" "'$ROOT/test/sv/eqv_check.sh' cbutton"
check "eqv.py: a clocked fault only at sw=ffff is caught" "'$ROOT/test/sv/eqv_check.sh' ones"
check "eqv.py: a clocked fault only at sw=7fff is caught" "'$ROOT/test/sv/eqv_check.sh' dense"
check "eqv.py: a clocked fault only at sw=0100 is caught" "'$ROOT/test/sv/eqv_check.sh' sparse"
check "eqv.py: a fault after 4000 cycles is caught" "'$ROOT/test/sv/eqv_check.sh' deep"
check "eqv.py: a fault when btnC is pressed after the start is caught" "'$ROOT/test/sv/eqv_check.sh' button"
check "eqv.py: an undriven (z) output is caught" "'$ROOT/test/sv/eqv_check.sh' zout"
check "eqv.py: an x output is caught" "'$ROOT/test/sv/eqv_check.sh' xout"
check "eqv.py: an FDRE with INIT x starts at 0, as on the board" "'$ROOT/test/sv/eqv_check.sh' init"
check "eqv.py: an FDSE with INIT x starts at 1, as on the board" "'$ROOT/test/sv/eqv_check.sh' fdse"
check "eqv.py: an LDPE with INIT x starts at 0, as on the board" "'$ROOT/test/sv/eqv_check.sh' ldpe"
check "eqv.py: a latch with no start value starts at 0 in the RTL too" "'$ROOT/test/sv/eqv_check.sh' ldfill"
check "eqv.py: a start value the netlist lost is caught" "'$ROOT/test/sv/eqv_check.sh' lostinit"
check "eqv.py: a register with no start value starts in the RTL as on the board" "'$ROOT/test/sv/eqv_check.sh' xstart"
check "eqv.py: a register with a synchronous set starts at 1 in the RTL too" "'$ROOT/test/sv/eqv_check.sh' fillset"
check "eqv.py: a register with an asynchronous set starts at 1 in the RTL too" "'$ROOT/test/sv/eqv_check.sh' fillaset"
check "eqv.py: a packed array of enums with no start value is started" "'$ROOT/test/sv/eqv_check.sh' pkenum"
check "eqv.py: a 1-bit enum with no start value is started" "'$ROOT/test/sv/eqv_check.sh' enum1"
check "eqv.py: a netlist that lost its reset is caught" "'$ROOT/test/sv/eqv_check.sh' lostreset"
check "eqv.py: a re-encoded state machine is compared after one reset" "'$ROOT/test/sv/eqv_check.sh' recode"
check "eqv.py: a kept submodule named as the RTL's passes" "'$ROOT/test/sv/eqv_check.sh' hier"
check "eqv.py: a fault inside a kept submodule is caught" "'$ROOT/test/sv/eqv_check.sh' hierfault"
check "eqv.py: ports named x, mode, seed, r, n, v, k do not clash with the bench" "'$ROOT/test/sv/eqv_check.sh' names"
check "eqv.py: an inout pin driven, read back and left floating passes" "'$ROOT/test/sv/eqv_check.sh' ioequal"
check "eqv.py: an inout pin read wrong is caught" "'$ROOT/test/sv/eqv_check.sh' ioread"
check "eqv.py: a netlist that drives a floating inout pin is caught" "'$ROOT/test/sv/eqv_check.sh' iofloat"
check "eqv.py: an output lost only between a button change and the clock edge is caught" "'$ROOT/test/sv/eqv_check.sh' mealyb"
check "eqv.py: a register with an asynchronous reset starts in the RTL as on the board" "'$ROOT/test/sv/eqv_check.sh' xstarta"
check "eqv.py: a latch with no start value starts at 0 in the RTL, as on the board" "'$ROOT/test/sv/eqv_check.sh' xstartl"
check "eqv.py: a reset value of 0011 starts each bit as its FDSE or FDRE does" "'$ROOT/test/sv/eqv_check.sh' fillasym"
check "eqv.sh: a submodule's register with no start value is started in the RTL" "'$ROOT/test/sv/eqv_check.sh' subreg"
check "eqv.sh: a fault in a submodule's register with no start value is caught" "'$ROOT/test/sv/eqv_check.sh' subfault"
check "eqv.py: a register that feeds a submodule's port is started by its own name" "'$ROOT/test/sv/eqv_check.sh' regport"
check "eqv.py: a register whose slice a wire names is started by its own name" "'$ROOT/test/sv/eqv_check.sh' regslice"
check "eqv.py: a register with an alias wire that sorts first is started by its own name" "'$ROOT/test/sv/eqv_check.sh' alias"
check "eqv.py: 1-bit enums of a submodule and of the file are started" "'$ROOT/test/sv/eqv_check.sh' enum1sub"
check "eqv.py: a 2-bit enum the netlist starts in a state the RTL never has is caught" "'$ROOT/test/sv/eqv_check.sh' enumstart"
check "eqv.py: a LUT RAM that powers up with the wrong contents is caught" "'$ROOT/test/sv/eqv_check.sh' memstart"
check "eqv.py: an output lost only between a switch change and the clock edge is caught" "'$ROOT/test/sv/eqv_check.sh' datasw"
check "eqv.sh: a bench that does not compile while the RTL does is a FAIL" "'$ROOT/test/sv/eqv_check.sh' nobench"
check "eqv.sh: a package in its own file that sorts after the design is compiled first" "'$ROOT/test/sv/eqv_check.sh' pkgfile"
check "eqv.py: a bench that compares nothing is a FAIL" "'$ROOT/test/sv/eqv_check.sh' nothing"
check "eqv.py: a netlist one clock off at the start, as dewfpga sim shows it, passes" "'$ROOT/test/sv/eqv_check.sh' romstart"
check "eqv.py: a netlist that mixes two starts is caught" "'$ROOT/test/sv/eqv_check.sh' mixstart"
check "eqv.py: a wrong netlist that matches sim's x-optimistic copy at some compares is caught" "'$ROOT/test/sv/eqv_check.sh' simflip"
check "eqv.py: a netlist that shows only what sim shows while its register is x is caught" "'$ROOT/test/sv/eqv_check.sh' simlost"
check "eqv.py: an x in sim's copy excuses no x in the netlist" "'$ROOT/test/sv/eqv_check.sh' xhold"
check "eqv.py: a reset on a switch is pressed first, like a button" "'$ROOT/test/sv/eqv_check.sh' swreset"
check "eqv.sh: a register that shares its variable with an assign is started" "'$ROOT/test/sv/eqv_check.sh' partassign"
check "eqv.py: an FDSE_1 and an FDPE_1 with INIT x start at 1, as on the board" "'$ROOT/test/sv/eqv_check.sh' negset"

# one line per probe: PASS when all four stages (rtl, synth, netlist, bit) did what test/sv/expect.tsv says,
# GAP when they did but Vivado passes a stage we fail (or the bitstream builds and is wrong), FAIL otherwise
want=$(( $(wc -l < "$ROOT/test/sv/expect.tsv") - 1 ))
if [ "$LIST" = 1 ]; then echo "$want probes"
elif [ -n "${ONLY:-}" ]; then echo "== SystemVerilog probes (test/sv): skipped, ONLY=$ONLY"; else
echo "== SystemVerilog probes (test/sv)"
svo=${SV_OUT:-$T/sv.tsv}; : > "$svo"
svrc=0; SV_OUT="$svo" "$ROOT/test/sv/run.sh" > "$T/sv.log" 2>&1 || svrc=$?
sv_rows "$svo" "$svrc" "$T/sv.log"
got=$(wc -l < "$svo")
[ "$got" -eq "$want" ] || { bad "sv: $got of $want probes reported"; tail -5 "$T/sv.log" | sed 's/^/       /'; }
grep -E '^synthesis ' "$T/sv.log" | sed 's/^/  /' || true
fi

if [ "$LIST" = 1 ] || [ "${FULL:-}" = 1 ]; then
    sec "== clean install into temp FPGA_HOME"
    check "clean install exit 0" "FPGA_HOME='$T/fresh' '$ROOT/install.sh'"
    check "fresh chain builds golden" "mkdir '$T/fw' && cp '$ROOT'/templates/{blink.sv,blink.xdc} '$T/fw/' && cd '$T/fw' && FPGA_HOME='$T/fresh' '$CLI' bit && diff <(strip blink.fasm) <(strip '$ROOT/test/golden/blink.fasm')"
fi

if [ "$LIST" = 1 ]; then echo "$((listed + want)) checks"; exit 0; fi
echo; echo "passed $pass, failed $fail, known gaps $gaps"
[ $fail -eq 0 ]
