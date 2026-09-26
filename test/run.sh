#!/usr/bin/env bash
# dewfpga test suite. Needs an installed toolchain (FPGA_HOME, default ~/fpga).
#   test/run.sh            everything except the clean install, including the SystemVerilog probes in test/sv
#   FULL=1 test/run.sh     also a clean install into a temp FPGA_HOME (~4 min, 1.4 GB)
#   SV_OUT=file            keep the probes' result rows (test/sv/run.sh writes them)
# A probe that does what test/sv/expect.tsv records but fails a stage Vivado passes, or builds a bitstream
# whose netlist fails, is a known GAP: printed and counted on its own, not as a pass, and it does not fail the
# run. A probe that fails a stage where Vivado refuses the code, or where what Vivado does is unverified, is a
# PASS, unless its bitstream builds from a netlist that fails: that silent wrong is a GAP whatever Vivado does.
# Each probe's verdict is worked out here again from expect.tsv and its four stages, and has to agree with
# test/sv/run.sh's, whose exit code has to agree with its rows.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/bin/dewfpga"
# the checks below cd around, so a relative SV_OUT is made absolute here, against the caller's folder
case ${SV_OUT:-} in ""|/*) ;; *) SV_OUT="$PWD/$SV_OUT" ;; esac
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
pass=0; fail=0; gaps=0
ok()   { pass=$((pass+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { fail=$((fail+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; }
gap()  { gaps=$((gaps+1)); printf '  \033[33mGAP\033[0m  %s\n' "$1"; }
check(){ if eval "$2" >"$T/out" 2>&1; then ok "$1"; else bad "$1"; sed 's/^/       /' "$T/out" | head -5; fi; }
# golden .fasm minus the tool-version comment line (differs between tag/sha checkouts)
strip() { grep -v '^# nextpnr' "$1" | sort; }

echo "== static"
check "shellcheck"            "shellcheck -S style '$ROOT/install.sh' '$CLI' '$ROOT/test/run.sh' '$ROOT/test/sv/run.sh' '$ROOT/test/sv/eqv.sh' '$ROOT/test/sv/eqv_check.sh'"
check "bash -n"               "bash -n '$ROOT/install.sh' && bash -n '$CLI'"
# every file is scanned, this one too: a home folder is /Users/ and a name (/Users/you/ is the guide's placeholder).
# This file writes the pattern with no name after /Users/, and its planted paths through printf's %s
personal_paths() { grep -rnoE '/Users/[A-Za-z0-9._-]+/?' --exclude-dir=.git --exclude-dir=.rabadon --exclude-dir=node_modules --exclude=.fpga_home "$1" | grep -vE ':/Users/you/?$'; }
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
check "unnamed instance -> line and fix" "mkdir -p '$T/ui' && printf 'module sub(input a, output b); assign b = a; endmodule\\nmodule ui(input logic [1:0] sw, output logic [1:0] led);\\n sub(sw[0], led[0]);\\n assign led[1] = sw[1];\\nendmodule\\n' > '$T/ui/ui.sv' && cp '$ROOT/templates/blink.xdc' '$T/ui/ui.xdc' && cd '$T/ui' && ! '$CLI' bit >out 2>&1 && grep -q 'ui.sv:3: .sub(. is an instance without a name' out && grep -qF 'Write:  sub u_sub(' out"
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

echo "== probe runner (test/sv/run.sh on a copy, one probe each)"
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
# 05 recorded as refused, under a yosys that is not the measured one: it builds a bitstream and its netlist fails
st_silent() {
    svcopy && echo 0.0-other > "$T/svr/test/golden/yosys-version" \
    && setrow 05_two_block_driver 6 fail && setrow 05_two_block_driver 7 - && setrow 05_two_block_driver 8 fail \
    && svrun 05_two_block_driver && grep -q 'a new silent wrong' "$T/svr/out"
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
p = sys.argv[1]; s = open(p).read(); old = "Give \" sig \" a default value at the top of the block."
assert old in s, "the latch advice changed; update this check"
open(p, "w").write(s.replace(old, "something went wrong.", 1))' "$T/svr/templates/Makefile" \
    && svrun 01_latch_comb && grep -qF "expect.tsv quotes 'Give q a default value at the top of the block.', no stage printed it" "$T/svr/out"
}
# the unnamed-instance fix replaced: 02's today column quotes it in "...", so the run has to miss the quote
st_fixtext() {
    svcopy && python3 -c '
import sys
p = sys.argv[1]; s = open(p).read(); old = "Write:  {other} u_{other}("
assert old in s, "the unnamed-instance fix changed; update this check"
open(p, "w").write(s.replace(old, "Fix it.", 1))' "$T/svr/templates/check_xdc.py" \
    && svrun 02_unnamed_inst && grep -qF "expect.tsv quotes 'Write:  inv u_inv(', no stage printed it" "$T/svr/out"
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
p = sys.argv[1]; s = open(p).read(); old = "(#\\s*\\([^;]*?\\))?"
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
p = sys.argv[1]; s = open(p).read(); old = "Drive each signal from one always block."
assert old in s, "the dual-edge advice changed; update this check"
open(p, "w").write(s.replace(old, "Use one edge.", 1))' "$T/svr/templates/Makefile" \
    && svrun 04_dual_edge && grep -qF "expect.tsv quotes 'Drive each signal from one always block.', no stage printed it" "$T/svr/out"
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
    printf '07_enum_packed_array\tok\tpass\tpass\tpass\tpass\t\n01_latch_comb\tgap\tpass\tfail\t-\tfail\t\n' > "$r"
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
if [ "$(yosys -V | awk '{print $2}')" = "$(cat "$ROOT/test/golden/yosys-version")" ]; then
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
echo "== SystemVerilog probes (test/sv)"
svo=${SV_OUT:-$T/sv.tsv}; : > "$svo"
svrc=0; SV_OUT="$svo" "$ROOT/test/sv/run.sh" > "$T/sv.log" 2>&1 || svrc=$?
sv_rows "$svo" "$svrc" "$T/sv.log"
want=$(( $(wc -l < "$ROOT/test/sv/expect.tsv") - 1 )); got=$(wc -l < "$svo")
[ "$got" -eq "$want" ] || { bad "sv: $got of $want probes reported"; tail -5 "$T/sv.log" | sed 's/^/       /'; }
grep -E '^synthesis ' "$T/sv.log" | sed 's/^/  /' || true

if [ "${FULL:-}" = 1 ]; then
    echo "== clean install into temp FPGA_HOME"
    check "clean install exit 0" "FPGA_HOME='$T/fresh' '$ROOT/install.sh'"
    check "fresh chain builds golden" "mkdir '$T/fw' && cp '$ROOT'/templates/{blink.sv,blink.xdc} '$T/fw/' && cd '$T/fw' && FPGA_HOME='$T/fresh' '$CLI' bit && diff <(strip blink.fasm) <(strip '$ROOT/test/golden/blink.fasm')"
fi

echo; echo "passed $pass, failed $fail, known gaps $gaps"
[ $fail -eq 0 ]
