#!/usr/bin/env bash
# Vivado project layout: the CLI on test/vivado/fixture ("Working Lab/NEW.xpr", a root with a space; sources_1/new,
# an external $PPRDIR/../archive file, an AutoDisabled duplicate, constrs_1, sim_1, TopModule), from the root and from
# the nested folder; the two-.xpr and missing-file errors; a flat folder byte-identical to the old CLI when an old CLI
# is given (OLD=/path/to/old/bin/dewfpga); DEWFPGA_ABSPATH=1 only when set. Self-contained: copies the fixture to a
# scratch folder, never writes into test/. Needs the installed toolchain (iverilog, yosys, nextpnr via .fpga_home).
# Usage: test/vivado/run.sh [OLD=<old dewfpga>]   last line: passed N, failed M
# Test ok/bad helpers both return success; quoted HDL and XPR variables are fixture data.
# shellcheck disable=SC2015,SC2016
set -u
HERE=$(cd "$(dirname "$0")/../.." && pwd); CLI=$HERE/bin/dewfpga; OLD=${OLD:-}
unset LC_ALL LC_CTYPE; export LANG=en_US.UTF-8   # perl (sim timeout, ABSPATH) panics on LC_ALL=C.UTF-8 on macOS
T=$(mktemp -d "${TMPDIR:-/tmp}/dewfpga-vivado.XXXXXX"); T=$(cd "$T" && pwd); trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ok()   { pass=$((pass+1)); echo "ok   $1"; }
bad()  { fail=$((fail+1)); echo "FAIL $1"; shift; printf '     %s\n' "$@"; }
check() {  # <name> <expected rc> <cmd...>; stdout+stderr in $out
    local name=$1 want=$2; shift 2
    out=$("$@" 2>&1); rc=$?
    [ "$rc" = "$want" ] && ok "$name" || bad "$name" "exit $rc, expected $want" "$out"
}
has() { grep -qF -- "$2" <<< "$1" || bad "$3" "missing: $2" "$1"; }

cp -R "$HERE/test/vivado/fixture" "$T/fx"; ROOT="$T/fx/Working Lab"; NESTED="$ROOT/NEW.srcs/sources_1/new"

# tops: same list from the root and the nested folder; the project's top first; nothing written
check "tops from root" 0 bash -c "cd '$ROOT' && '$CLI' tops"; r=$out
[ "$r" = $'topmodule\tNEW.srcs/sources_1/new/topmodule.sv' ] && ok "tops lists the project top with its root-relative file" || bad "tops list" "$r"
check "tops from nested folder" 0 bash -c "cd '$NESTED' && '$CLI' tops"; [ "$out" = "$r" ] && ok "tops identical from the nested folder" || bad "tops nested" "$out"
[ "$(ls "$ROOT")" = $'NEW.srcs\nNEW.xpr' ] && ok "tops wrote nothing" || bad "tops wrote" "$(ls "$ROOT")"

# sim from the root: the enabled files, the disabled duplicate skipped, the external file found, outputs in the root
check "sim from root" 0 bash -c "cd '$ROOT' && '$CLI' sim"
has "$out" "vivado project: $ROOT/NEW.xpr (top from the project: topmodule)" "sim names the project"
has "$out" "tb done" "sim ran the testbench"
grep -q counter2_old <<< "$out" && bad "sim read the disabled duplicate" "$out" || ok "sim skipped the AutoDisabled file"
[ -f "$ROOT/topmodule_sim" ] && ok "sim output lands in the root" || bad "sim output" "$(ls "$ROOT")"
# sim from the nested folder: same result, nothing written next to the sources
check "sim from nested folder" 0 bash -c "cd '$NESTED' && '$CLI' sim"
has "$out" "tb done" "nested sim ran the testbench"
[ "$(ls "$NESTED")" = $'counter2_old.sv\ntopmodule.sv' ] && ok "nested sim wrote nothing beside the sources" || bad "nested sim wrote" "$(ls "$NESTED")"
# bit from the nested folder: constraints from constrs_1, the .bit in the root
check "bit from nested folder" 0 bash -c "cd '$NESTED' && '$CLI' bit"
has "$out" "xdc ok" "bit used the constraint set"; has "$out" "topmodule.bit" "bit produced the bitstream"
[ -s "$ROOT/topmodule.bit" ] && ok "the .bit is in the root" || bad "no .bit in the root" "$(ls "$ROOT")"
check "clean from nested folder" 0 bash -c "cd '$NESTED' && '$CLI' clean"
[ "$(ls "$ROOT")" = $'NEW.srcs\nNEW.xpr' ] && ok "clean removed the outputs from the root" || bad "clean left" "$(ls "$ROOT")"
# a top named on the command line wins over the project's
check "named top" 0 bash -c "cd '$ROOT' && '$CLI' sim topmodule"; has "$out" "vivado project: $ROOT/NEW.xpr"$'\n' "named top: project line without the project top"

# errors: explicit, nonzero
cp "$ROOT/NEW.xpr" "$ROOT/OLD.xpr"
check "two .xpr" 1 bash -c "cd '$NESTED' && '$CLI' sim"; has "$out" "ERROR [two-vivado-projects]" "two .xpr code"; rm "$ROOT/OLD.xpr"
mv "$T/fx/archive/counter2.sv" "$T/fx/counter2.keep"
check "missing listed file" 1 bash -c "cd '$ROOT' && '$CLI' sim"; has "$out" "NEW.xpr:11: ERROR [vivado-file-missing]" "missing file names the .xpr line"
check "tops with a missing file" 1 bash -c "cd '$ROOT' && '$CLI' tops"
mv "$T/fx/counter2.keep" "$T/fx/archive/counter2.sv"
cp -R "$T/fx" "$T/bad"; echo "<Project" > "$T/bad/Working Lab/NEW.xpr"
check "unreadable .xpr" 1 bash -c "cd '$T/bad/Working Lab' && '$CLI' sim"; has "$out" "ERROR [vivado-project-unreadable]" "unreadable code"

# .srcs layout without a .xpr: the folders are the lists, the top is found by the scanner
cp -R "$T/fx" "$T/srcs"; S="$T/srcs/Working Lab"; rm "$S/NEW.xpr" "$S/NEW.srcs/sources_1/new/counter2_old.sv"; cp "$T/srcs/archive/counter2.sv" "$S/NEW.srcs/sources_1/new/"
check "srcs-only tops" 0 bash -c "cd '$S/NEW.srcs/sim_1/new' && '$CLI' tops"; [ "$out" = $'topmodule\tNEW.srcs/sources_1/new/topmodule.sv' ] && ok "srcs-only top" || bad "srcs-only top" "$out"
check "srcs-only sim" 0 bash -c "cd '$S/NEW.srcs/sim_1/new' && '$CLI' sim"; has "$out" "tb done" "srcs-only sim ran"

# a flat folder: untouched behaviour; tops; ABSPATH only when set
mkdir -p "$T/flat"; printf 'module bad(input logic a, output logic y);\n    assign y = a &&& ;\nendmodule\n' > "$T/flat/bad.sv"
printf 'set_property -dict { PACKAGE_PIN V17 IOSTANDARD LVCMOS33 } [get_ports a]\nset_property -dict { PACKAGE_PIN U16 IOSTANDARD LVCMOS33 } [get_ports y]\n' > "$T/flat/bad.xdc"
check "flat bit error" 2 bash -c "cd '$T/flat' && '$CLI' bit"; new=$out
has "$new" $'\nbad.sv:2: ERROR [slang-refused]' "flat error keeps the relative path"
if [ -n "$OLD" ]; then
    old=$(cd "$T/flat" && "$OLD" bit 2>&1); [ "$old" = "$new" ] && ok "flat folder byte-identical to $OLD" || bad "flat differs from $OLD" "$(diff <(echo "$old") <(echo "$new"))"
fi
check "flat ABSPATH" 2 bash -c "cd '$T/flat' && DEWFPGA_ABSPATH=1 '$CLI' bit"; has "$out" $'\n'"$T/flat/bad.sv:2: ERROR [slang-refused]" "ABSPATH prefixes the leading file:line"
check "flat tops" 0 bash -c "cd '$T/flat' && '$CLI' tops"; [ "$out" = $'bad\tbad.sv' ] && ok "flat tops list" || bad "flat tops list" "$out"
mkdir "$T/empty"; check "tops in an empty folder" 0 bash -c "cd '$T/empty' && '$CLI' tops"; [ -z "$out" ] && ok "empty tops prints nothing" || bad "empty tops" "$out"
check "fixture ABSPATH sim" 0 bash -c "cd '$NESTED' && DEWFPGA_ABSPATH=1 '$CLI' sim"; has "$out" "$ROOT/NEW.srcs/sim_1/new/tb.sv:11: \$finish" "ABSPATH in the project: root-absolute"
bash -c "cd '$ROOT' && '$CLI' clean" >/dev/null 2>&1

# ---- #12 review fixes (R1-R7): fixture "Mixed Lab/MIX.xpr": sources_1 = new/top.sv (`include "defs.svh", a hierarchical
# name that sends the build to yosys-slang) + new/defs.svh + imports/helper.v (bit and final as names: Verilog-2005);
# sim_1 = new/tb.sv + new/clkgen.sv (a module with ports and a $finish: simulation-only); constrs_1 = new/top.xdc;
# <Run synth_1 SrcSet ConstrsSet> and ActiveSimSet name the sets.
MIX="$T/fx/Mixed Lab"; MSRC="$MIX/MIX.srcs/sources_1"
# R1: a nested .v stays Verilog-2005 on the slang path (and in iverilog), root with a space
check "mixed bit (slang path, nested .v, spaced root)" 0 bash -c "cd '$MIX' && '$CLI' bit"
has "$out" "note [read-with-slang]" "mixed bit went through yosys-slang"
has "$out" "top.bit" "mixed bit wrote the bitstream"
[ -f "$MIX/top.bit" ] && ok "mixed .bit in the root" || bad "mixed .bit" "$(ls "$MIX")"
nokw() {
    local d
    for d in "$1"/.dewfpga-kw.*; do
        if [ -e "$d" ]; then bad "$2" "private folder remains: $d"; return; fi
    done
    ok "$2"
}
nokw "$MIX" "wrapped .v copies removed"
# R1 flat: the same files in a flat, space-free folder
mkdir "$T/mixflat"; cp "$MSRC/new/top.sv" "$MSRC/new/defs.svh" "$MSRC/imports/helper.v" "$MIX/MIX.srcs/constrs_1/new/top.xdc" "$T/mixflat/"
check "mixed flat bit" 0 bash -c "cd '$T/mixflat' && '$CLI' bit"; has "$out" "note [read-with-slang]" "flat .v + slang"
# R2: simulation-only files are the sim's, not the design's
check "mixed sim" 0 bash -c "cd '$MIX' && '$CLI' sim"
has "$out" "clkgen.sv" "sim compiles the simulation set's file"
has "$out" "mixed tb done" "mixed sim ran the testbench"
grep -q "finish-in-design" <<< "$out" && bad "sim flagged \$finish in a simulation-only module" "$out" || ok "sim: \$finish in a simulation-only module is fine"
check "mixed tops" 0 bash -c "cd '$MIX' && '$CLI' tops"; [ "$out" = $'top\tMIX.srcs/sources_1/new/top.sv' ] && ok "tops leaves clkgen out" || bad "tops" "$out"
bash -c "cd '$MIX' && '$CLI' clean" >/dev/null 2>&1; bitout=$(cd "$MIX" && "$CLI" bit 2>&1)
grep -q "clkgen" <<< "$bitout" && bad "bit read the simulation set" "$bitout" || ok "bit leaves the simulation set out"
# R4: `include found by every tool; a header edit reruns sim and bit
sleep 1; touch "$MSRC/new/defs.svh"
check "sim after header edit" 0 bash -c "cd '$MIX' && '$CLI' sim"; has "$out" "iverilog" "header edit reran the simulation"
check "bit after header edit" 0 bash -c "cd '$MIX' && '$CLI' bit"; has "$out" "top.bit" "header edit rebuilt the bitstream"
check "bit with nothing changed" 0 bash -c "cd '$MIX' && '$CLI' bit"; grep -q "xdc ok" <<< "$out" && bad "bit rebuilt with nothing changed" "$out" || ok "bit stays quiet with nothing changed"
# R3: a listed path with a space: one actionable line with the .xpr line, no word split, no head: error
cp -R "$MIX" "$T/space"; cp "$T/space/MIX.srcs/sources_1/new/top.sv" "$T/space/MIX.srcs/sources_1/new/top module.sv"
sed -i '' 's|sources_1/new/top.sv"|sources_1/new/top module.sv"|' "$T/space/MIX.xpr"; line=$(grep -n 'top module.sv' "$T/space/MIX.xpr" | cut -d: -f1)
check "listed path with a space" 1 bash -c "cd '$T/space' && '$CLI' sim"
has "$out" "MIX.xpr:$line: ERROR [file-name-with-space]: MIX.xpr lists 'MIX.srcs/sources_1/new/top module.sv'" "space: the .xpr line and the whole name"
has "$out" "Rename" "space: the Vivado rename step"
grep -q "head:" <<< "$out" && bad "space: head error leaked" "$out" || ok "space: no head error"
# R7: a project variable dewfpga does not know is an error, not a vanished file
cp -R "$MIX" "$T/pvar"; sed -i '' 's|\$PSRCDIR/sources_1/imports/helper.v|$PCACHEDIR/helper.v|' "$T/pvar/MIX.xpr"; line=$(grep -n 'PCACHEDIR' "$T/pvar/MIX.xpr" | cut -d: -f1)
check "unknown project variable" 1 bash -c "cd '$T/pvar' && '$CLI' bit"
has "$out" "MIX.xpr:$line: ERROR [vivado-path-unknown]: MIX.xpr lists \$PCACHEDIR/helper.v, and dewfpga does not know where Vivado keeps \$PCACHEDIR" "unknown variable named"
# R5: two simulation sets and nothing says which is active: a clear stop, no guess
cp -R "$MIX" "$T/twosim"; python3 - "$T/twosim/MIX.xpr" <<'EOF'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace('<Option Name="ActiveSimSet" Val="sim_1"/>','')
s=s.replace('<FileSet Name="utils_1"','<FileSet Name="sim_2" Type="SimulationSrcs" RelSrcDir="$PSRCDIR/sim_2"/>\n    <FileSet Name="utils_1"')
open(p,'w').write(s)
EOF
check "two simulation sets, no ActiveSimSet" 1 bash -c "cd '$T/twosim' && '$CLI' sim"
has "$out" "ERROR [vivado-set-ambiguous]: MIX.xpr has 2 simulation sets (sim_1, sim_2) and" "ambiguous sets named"
has "$out" "Make Active" "ambiguous: the Vivado step"
check "two simulation sets: bit does not care" 0 bash -c "cd '$T/twosim' && '$CLI' tops"; [ "$out" = $'top\tMIX.srcs/sources_1/new/top.sv' ] && ok "ambiguous sim set leaves bit/tops alone" || bad "ambiguous sim set" "$out"
# R5: the Run's SrcSet wins over a second design set
cp -R "$MIX" "$T/twosrc"; python3 - "$T/twosrc/MIX.xpr" <<'EOF'
import sys; p=sys.argv[1]; s=open(p).read()
s=s.replace('<FileSet Name="utils_1"','<FileSet Name="sources_2" Type="DesignSrcs" RelSrcDir="$PSRCDIR/sources_2"><File Path="$PSRCDIR/sources_1/new/does_not_exist.sv"/></FileSet>\n    <FileSet Name="utils_1"')
open(p,'w').write(s)
EOF
check "two design sets, synth_1 names one" 0 bash -c "cd '$T/twosrc' && '$CLI' tops"; [ "$out" = $'top\tMIX.srcs/sources_1/new/top.sv' ] && ok "synth_1's SrcSet chosen" || bad "SrcSet" "$out"
# R6: an empty project with a design beside it: the message says the file is not in the project, and how out
mkdir -p "$T/emptyproj/E.srcs/sources_1/new"; cp "$MSRC/new/top.sv" "$T/emptyproj/"
printf '<?xml version="1.0"?>\n<Project Version="7" Path="E.xpr">\n  <FileSets>\n    <FileSet Name="sources_1" Type="DesignSrcs" RelSrcDir="$PSRCDIR/sources_1"/>\n    <FileSet Name="constrs_1" Type="Constrs" RelSrcDir="$PSRCDIR/constrs_1"/>\n  </FileSets>\n</Project>\n' > "$T/emptyproj/E.xpr"
check "empty project" 1 bash -c "cd '$T/emptyproj' && '$CLI' sim"
has "$out" "ERROR [no-source-file]: E.xpr lists no .sv or .v design file (a file beside it is not in the project until it is added in Vivado: Sources > Add Sources)" "empty project: accurate message"
has "$out" "copy the .sv and .xdc files to a folder outside the project and run dewfpga there" "empty project: the way out"
check "empty project tops" 0 bash -c "cd '$T/emptyproj' && '$CLI' tops"; [ -z "$out" ] && ok "empty project tops prints nothing" || bad "empty project tops" "$out"
# R6: the escape in the missing-file and two-.xpr errors too
cp -R "$MIX" "$T/esc"; rm "$T/esc/MIX.srcs/sources_1/imports/helper.v"
check "missing file names the way out" 1 bash -c "cd '$T/esc' && '$CLI' bit"; has "$out" "run dewfpga there" "missing file: escape"
cp "$T/esc/MIX.xpr" "$T/esc/MIX2.xpr"; check "two .xpr name the way out" 1 bash -c "cd '$T/esc' && '$CLI' bit"; has "$out" "run dewfpga there" "two .xpr: escape"
bash -c "cd '$MIX' && '$CLI' clean" >/dev/null 2>&1

# v3: the wrapped .v copies live in a private mktemp folder (.dewfpga-kw.XXXXXX, marked inside); a folder the student
# owns, top.kw included, is never removed, on success, on a refused file, by clean; two sources that differ only in
# their folder (a/b.v, a_b.v) get distinct copies. Checked through the CLI and through make itself (the root's case).
kept() { [ "$(cat "$1/top.kw/keep.txt" 2>/dev/null)" = keep ] && ok "$2" || bad "$2" "top.kw/keep.txt gone or changed" "$(ls -A "$1")"; }
mkdir -p "$MIX/top.kw"; echo keep > "$MIX/top.kw/keep.txt"
check "bit with a foreign top.kw (slang path)" 0 bash -c "cd '$MIX' && '$CLI' clean >/dev/null 2>&1; '$CLI' bit"
has "$out" "note [read-with-slang]" "foreign top.kw: bit still went through yosys-slang"
kept "$MIX" "bit left the student's top.kw alone"; nokw "$MIX" "bit: no private folder left"
check "sim with a foreign top.kw" 0 bash -c "cd '$MIX' && '$CLI' sim"; has "$out" "mixed tb done" "foreign top.kw: sim ran"
kept "$MIX" "sim left the student's top.kw alone"; nokw "$MIX" "sim: no private folder left"
check "clean with a foreign top.kw" 0 bash -c "cd '$MIX' && '$CLI' clean"; kept "$MIX" "clean left the student's top.kw alone"
# the root's counterexample: a flat folder, no .v at all, make called directly
mkdir -p "$T/flat/top.kw"; echo keep > "$T/flat/top.kw/keep.txt"
printf 'module top(input logic a, output logic q); assign q = ~a; endmodule\n' > "$T/flat/top.sv"
printf 'module tb; logic a, q; top u(.a(a),.q(q)); initial begin a=0; #1 $display("q=%%0d", q); $finish; end endmodule\n' > "$T/flat/tb.sv"
check "make sim, no .v, foreign top.kw" 0 bash -c "cd '$T/flat' && make -f '$HERE/templates/Makefile' sim TOP=top SRCS=top.sv TB=tb.sv"
has "$out" "q=1" "make sim ran"; kept "$T/flat" "make sim left top.kw alone"; nokw "$T/flat" "make sim: no private folder left"
# clean removes only a folder that carries dewfpga's marker; a same-shaped folder without it stays
mkdir "$T/flat/.dewfpga-kw.stale1" "$T/flat/.dewfpga-kw.theirs"; : > "$T/flat/.dewfpga-kw.stale1/.dewfpga-kw"; : > "$T/flat/.dewfpga-kw.theirs/notes"
check "make clean, foreign top.kw" 0 bash -c "cd '$T/flat' && make -f '$HERE/templates/Makefile' clean TOP=top"
kept "$T/flat" "make clean left top.kw alone"
[ -f "$T/flat/.dewfpga-kw.stale1/.dewfpga-kw" ] && ok "clean preserves another recipe marked work folder" || bad "clean removed another recipe work folder" "$(ls -A "$T/flat")"
[ -f "$T/flat/.dewfpga-kw.theirs/notes" ] && ok "clean left an unmarked look-alike folder alone" || bad "clean removed an unmarked folder" "$(ls -A "$T/flat")"
# a/b.v and a_b.v: two different modules, both read, both right, in sim and in bit
cp -R "$MIX" "$T/coll"; CS="$T/coll/MIX.srcs/sources_1"; mkdir -p "$CS/a"; rm "$CS/imports/helper.v"
printf 'module m1(input wire a, input wire b, output wire y); wire bit; assign bit = a & b; assign y = bit; endmodule\n' > "$CS/a/b.v"
printf 'module m2(input wire a, input wire b, output wire y); wire final; assign final = a | b; assign y = final; endmodule\n' > "$CS/a_b.v"
printf '`include "defs.svh"\nmodule top(input logic [`W-1:0] sw, output logic led);\n    logic x, o; m1 u1(.a(sw[0]), .b(sw[1]), .y(x)); m2 u2(.a(sw[0]), .b(sw[1]), .y(o));\n    assign led = u1.y ^ u2.y;\nendmodule\n' > "$CS/new/top.sv"
printf 'module tb; logic [1:0] sw; logic led, clk; clkgen u_clk(.clk(clk)); top dut(.sw(sw), .led(led));\n    initial begin sw = 2'"'"'b01; #10 $display("and=%%0d or=%%0d led=%%0d", dut.x, dut.o, led); if (led !== 1) $error("led=%%b, expected 1", led);\n    sw = 2'"'"'b11; #10 if (led !== 0) $error("led=%%b, expected 0", led); $display("coll tb done"); $finish; end\nendmodule\n' > "$T/coll/MIX.srcs/sim_1/new/tb.sv"
sed -i '' 's|<File Path="$PSRCDIR/sources_1/imports/helper.v"/>|<File Path="$PSRCDIR/sources_1/a/b.v"/>\n      <File Path="$PSRCDIR/sources_1/a_b.v"/>|' "$T/coll/MIX.xpr"
check "a/b.v and a_b.v: sim" 0 bash -c "cd '$T/coll' && '$CLI' sim"
has "$out" "and=0 or=1 led=1" "a/b.v is m1 (and), a_b.v is m2 (or)"; has "$out" "coll tb done" "collision sim ran to the end"
grep -q "expected" <<< "$out" && bad "collision sim: wrong value" "$out" || ok "collision sim: no wrong value"
check "a/b.v and a_b.v: bit" 0 bash -c "cd '$T/coll' && '$CLI' bit"
has "$out" "note [read-with-slang]" "collision bit went through yosys-slang"; has "$out" "top.bit" "collision bit wrote the bitstream"
kept "$T/coll" "collision bit left top.kw alone"; nokw "$T/coll" "collision bit: no private folder left"
# a refused .v: the message names the student's file, nothing of dewfpga's stays behind, the student's folder stays
cp -R "$MIX" "$T/brk"; printf 'module helper(input [1:0] a output y); endmodule\n' > "$T/brk/MIX.srcs/sources_1/imports/helper.v"
check "refused .v: sim" 2 bash -c "cd '$T/brk' && '$CLI' sim"
has "$out" "MIX.srcs/sources_1/imports/helper.v:1: ERROR [iverilog-refused]" "refused .v: sim names the student's file"
kept "$T/brk" "refused .v: sim left top.kw alone"; nokw "$T/brk" "refused .v: sim left no private folder"
check "refused .v: bit" 2 bash -c "cd '$T/brk' && '$CLI' bit"
kept "$T/brk" "refused .v: bit left top.kw alone"; nokw "$T/brk" "refused .v: bit left no private folder"
bash -c "cd '$MIX' && '$CLI' clean" >/dev/null 2>&1

check "simulation-set errors leave design commands usable" 0 python3 -B "$HERE/test/vivado/test-simset.py"

echo "passed $pass, failed $fail"; [ "$fail" = 0 ]
