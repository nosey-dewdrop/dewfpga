#!/usr/bin/env bash
# SystemVerilog probes: each folder here is one construct a student may write. design.sv (design.v for a
# Verilog-2005 file) has `module top`, tb.sv has `module tb` and prints PASS when the design behaves; a probe
# may add a .svh, a .mem, another .sv (a package, an interface or a submodule in its own file), or its own
# Basys3_Master.xdc with only the pins it uses uncommented, as a lab folder often has it. Every probe
# goes through the product (bin/dewfpga and templates/Makefile), in a temp copy that holds only the probe's
# sources, four stages:
#   rtl      dewfpga sim                                        pass = exit 0 and the testbench printed PASS
#   synth    dewfpga bit, with the whole Basys3_Master.xdc uncommented   pass = the product wrote top.json
#            (or the probe's own XDC)
#            (or <name>.json when the CLI took another module for the top: the stages check what it built,
#            and the row's note names it)
#   netlist  that netlist written back as Verilog (- when there is none), and
#              a) simulated with tb.sv and yosys' xilinx cells_sim.v: the testbench prints PASS
#              b) compared with the RTL (eqv.py): the same inputs, every input combination (all zeros included)
#                 when there are 16 input bits or fewer and no clock, else 4096 random cycles that include
#                 all-zero, all-one, mostly-zero and mostly-one values, buttons pressed; every output bit the
#                 RTL knows must be equal, and an x or z in the netlist is not. Both start as the board does:
#                 a register without a start value at its primitive's default in the netlist, and at the
#                 same value in the RTL; with a clock, every button and every input bit that resets a
#                 register is held for one clock edge before the first compare, as a student presses reset
#                 after loading the board. The run also passes when the netlist follows, at every compare,
#                 the RTL as dewfpga sim starts it (x where it gives no start value) once that copy has no
#                 x register bit left, and the board's start before then: the board then shows what the
#                 student's simulation shows. The netlist's
#                 modules are renamed, so a submodule yosys kept does not clash with the RTL's. Skipped, and
#                 said so, when iverilog cannot compile the RTL. eqv.sh runs it, and eqv_check.sh runs the
#                 same eqv.sh on netlists that differ from their RTL in one known way.
#            This checks what synthesis made, not place-and-route or the bitstream.
#   bit      the same dewfpga bit                               pass = exit 0 and that netlist's .bit written
# expect.tsv records what every stage does today. Any difference fails the run: a regression, or an
# unexpected pass that expect.tsv has to record. Its vivado column says whether Vivado accepts the construct,
# with the source, and the source has to back it: "not supported" needs the guide's "Not Supported" or
# invalid code, "unverified" needs the reason no source settles it (a guide that contradicts itself is one).
# A file:line in its today column, and every message it quotes ('...' or "..."), must appear in what the
# stages printed.
# A probe that matches expect.tsv is a known gap when Vivado supports it and a stage fails, or when it is a
# silent wrong (the bitstream builds and the netlist fails).
#   test/sv/run.sh [id...]         all probes, or the ones named
#   SV_OUT=file test/sv/run.sh     also one tab-separated row per probe: id, ok|gap|bad, rtl, synth, netlist, bit, message
#   KEEP=1 test/sv/run.sh          keep the work folder
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLI="$ROOT/bin/dewfpga"
EXPECT="$HERE/expect.tsv"
TIMEOUT=30                       # seconds; the netlist of an async-load loop never reaches $finish
# expect.tsv was measured with these. With another yosys or iverilog only a stage that used to pass and now
# fails counts (students get whatever brew ships), and so does a new silent wrong; a stage that starts
# passing is printed as a note.
YOSYS_MEASURED=$(cat "$ROOT/test/golden/yosys-version")
IVERILOG_MEASURED=13.0
YV=$(yosys -V | awk '{print $2}')
IV=$(iverilog -V 2>&1 | awk 'NR==1{print $4}')
CELLS="$(yosys-config --datdir)/xilinx/cells_sim.v"
[ -s "$CELLS" ] || { echo "ERROR: $CELLS not found (yosys-config --datdir)" >&2; exit 1; }
exact=1; [ "$YV" = "$YOSYS_MEASURED" ] && [ "$IV" = "$IVERILOG_MEASURED" ] || exact=0

HEADER=$'id\tconstruct\tvivado\tvivado_source\trtl\tsynth\tnetlist\tbit\ttoday'
[ "$(head -1 "$EXPECT")" = "$HEADER" ] || { echo "ERROR: $EXPECT header is not: $HEADER" >&2; exit 1; }
bad_rows=$(awk -F'\t' 'NR>1 && (NF!=9 || $3!~/^(supported|not supported|unverified)$/ || $4!~/[A-Za-z]/ || $9=="" || $5!~/^(pass|fail)$/ || $6!~/^(pass|fail)$/ || $7!~/^(pass|fail|-)$/ || $8!~/^(pass|fail)$/ || ($6=="fail") != ($7=="-")) {print NR": "$1}' "$EXPECT")
[ -z "$bad_rows" ] || { echo "ERROR: malformed rows in $EXPECT (9 tab-separated fields; a source for the vivado column; stages pass|fail, netlist - exactly when synth fails; today not empty):" >&2; echo "$bad_rows" >&2; exit 1; }
# a probe that stops counting as a gap has to say why in its source, not only in the vivado column. A source
# that quotes a "Not Supported" row is "not supported", unless it shows the guide contradicting itself (a
# Supported row for the same construct): that is "unverified"
NOTSUP=": Not Supported'|Invalid code"
UNVER="does not say what Vivado does|is not described|[Ww]eak source only|[Nn]o Vivado log|contradicts itself"
bad_col=$(awk -F'\t' -v ns="$NOTSUP" -v uv="$UNVER" 'NR>1 { c = ($4 ~ /contradicts itself/); n = ($4 ~ ns) && !c }
    NR>1 && (($3=="not supported") != n || ($3=="unverified") != ($4~uv && !n)) {print NR": "$1" ("$3")"}' "$EXPECT")
[ -z "$bad_col" ] || { echo "ERROR: rows of $EXPECT whose vivado column does not match its source (\"not supported\" needs $NOTSUP; \"unverified\" needs $UNVER, and 'contradicts itself' when it quotes a Not Supported row; \"supported\" neither):" >&2; echo "$bad_col" >&2; exit 1; }
# every probe folder has a row and every row a folder
diff <(awk -F'\t' 'NR>1{print $1}' "$EXPECT" | sort) <(cd "$HERE" && for d in */; do echo "${d%/}"; done | sort) >/dev/null \
    || { echo "ERROR: the probe folders and the rows of $EXPECT differ:" >&2; diff <(awk -F'\t' 'NR>1{print $1}' "$EXPECT" | sort) <(cd "$HERE" && for d in */; do echo "${d%/}"; done | sort) >&2; exit 1; }

# bash 3.2 (macOS): no mapfile, and no empty arrays under set -u
# shellcheck disable=SC2046   # probe ids are single words
[ $# -gt 0 ] || set -- $(awk -F'\t' 'NR>1{print $1}' "$EXPECT")

W=$(mktemp -d); if [ -n "${KEEP:-}" ]; then echo "work: $W"; else trap 'rm -rf "$W"' EXIT; fi
# the course's master XDC with every pin line uncommented, as a lab folder has it (create_clock stays
# commented, so timing is checked at the Basys3's 100 MHz like any lab without one)
sed 's/^#set_property/set_property/' "$ROOT/templates/Basys3_Master.xdc" > "$W/Basys3_Master.xdc"
[ -z "${SV_OUT:-}" ] || : > "$SV_OUT"

tmo() { perl -e '$SIG{ALRM}=sub{kill TERM=>$p; select(undef,undef,undef,0.3); kill KILL=>$p; exit 142}; alarm shift; $p=fork; exec @ARGV if !$p; waitpid $p,0; exit($?>>8)' "$TIMEOUT" "$@"; }
first_err() { grep -m1 -E 'ERROR|FAIL|MISMATCH|[Ee]rror|syntax|sorry|Unknown' "$1" || grep -m1 . "$1" || echo "(no output)"; }
# the messages a today column quotes, '...' or "...", one piece per line: a quote is cut at each ... it uses
# to leave text out, a yosys name inside it (`\sw [3:0]') stays whole, and a name in single quotes inside a
# "..." quote is not a quote of its own
quotes() {
    perl -e '$_ = shift; my @n;
        s/`[^`\x27]*\x27/push @n, $&; "\0$#n\0"/ge;
        my @q = /"([^"]+)"/g; s/"[^"]+"/ /g;
        for my $q (@q, /(?:^|(?<=[\s(]))\x27(.+?)\x27(?=$|[\s,;.:)])/g) {
            $q =~ s/\0(\d+)\0/$n[$1]/g;
            for (split /\.\.\./, $q) { s/^\s+|\s+$//g; print "$_\n" if length }
        }' "$1"
}
n=0; nok=0; nsyn=0; nall=0; nsup=0; nsupall=0; ngap=0
echo "test/sv: $# probes, yosys $YV, iverilog $IV$( [ $exact = 1 ] || echo "  (expect.tsv was measured with yosys $YOSYS_MEASURED, iverilog $IVERILOG_MEASURED: only regressions and new silent wrongs fail)")"
for id in "$@"; do
    row=$(awk -F'\t' -v id="$id" '$1==id{print $3"|"$5"|"$6"|"$7"|"$8}' "$EXPECT")
    [ -n "$row" ] || { echo "ERROR: no probe named $id in $EXPECT" >&2; exit 1; }
    IFS='|' read -r vivado e_rtl e_syn e_net e_bit <<< "$row"
    today=$(awk -F'\t' -v id="$id" '$1==id{print $9}' "$EXPECT")
    # only the probe's sources: a build output left in the folder (top_sim, top.json) would get a fresh
    # mtime in the copy, and make would reuse it instead of building
    P="$W/$id"; mkdir -p "$P"
    for f in "$HERE/$id"/*; do case $f in *.sv|*.svh|*.v|*.vh|*.mem) cp "$f" "$P/" ;; esac; done
    if [ -f "$HERE/$id/Basys3_Master.xdc" ]; then cp "$HERE/$id/Basys3_Master.xdc" "$P/"; else cp "$W/Basys3_Master.xdc" "$P/"; fi
    # 1 rtl: the product's simulation (iverilog), its own timeout lowered for the suite
    if (cd "$P" && SIM_TIMEOUT=$TIMEOUT "$CLI" sim) > "$P/rtl.log" 2>&1 && grep -qx PASS "$P/rtl.log"; then rtl=pass; else rtl=fail; fi
    # 2 synth and 4 bit: one dewfpga bit run. What it built is top.json and top.bit, or <name>.json and
    # <name>.bit when the CLI took another module for the top: that is what the student gets (exit 0 and a
    # bitstream), so it is what the stages check, and the row's note names it
    brc=0; (cd "$P" && "$CLI" bit) > "$P/bit.log" 2>&1 || brc=$?
    built=top; notes=""
    if [ ! -s "$P/top.json" ]; then
        for f in "$P"/*.json; do case $f in *_routed.json) ;; *) [ -s "$f" ] && built=$(basename "$f" .json) ;; esac; done
    fi
    [ "$built" = top ] || notes="the CLI took $built for the top"
    if [ -s "$P/$built.json" ]; then syn=pass; else syn=fail; fi
    if [ $brc -eq 0 ] && [ -s "$P/$built.bit" ]; then bit=pass; else bit=fail; fi
    # 3 netlist: what the product synthesized, against the same testbench, then against the RTL
    net=-
    if [ $syn = pass ]; then
        nrc=0; (cd "$P" && yosys -q -p "read_json $built.json; write_verilog -noattr net.v" && iverilog -g2012 -s tb -o net.vvp net.v tb.sv "$CELLS" && tmo vvp -n net.vvp) > "$P/net.log" 2>&1 || nrc=$?
        [ $nrc -ne 142 ] || echo "TIMEOUT: the netlist simulation did not reach \$finish in $TIMEOUT s" >> "$P/net.log"
        net=fail; [ $nrc -eq 0 ] && grep -qx PASS "$P/net.log" && net=pass
        if [ $net = pass ]; then
            erc=0; (cd "$P" && TIMEOUT=$TIMEOUT "$HERE/eqv.sh" "$built.json") >> "$P/net.log" 2>&1 || erc=$?
            if [ $erc -eq 2 ]; then notes="${notes:+$notes; }netlist: testbench only, iverilog cannot compile the RTL"
            elif [ $erc -ne 0 ] || ! grep -q '^EQV PASS' "$P/net.log"; then net=fail; fi
        fi
    fi
    # compare
    diffs=""
    for s in rtl:$rtl:$e_rtl synth:$syn:$e_syn netlist:$net:$e_net bit:$bit:$e_bit; do
        IFS=: read -r stage got want <<< "$s"
        [ "$got" = "$want" ] && continue
        if [ $exact = 1 ] || [ "$want" = pass ]; then diffs="${diffs:+$diffs; }$stage $got, expected $want"
        else notes="${notes:+$notes; }$stage $got, expected $want"; fi
    done
    # a silent wrong (bitstream built, netlist wrong) that expect.tsv does not record is never an improvement
    silent=0; [ $bit = pass ] && [ $net = fail ] && silent=1
    if [ $silent = 1 ] && ! { [ "$e_bit" = pass ] && [ "$e_net" = fail ]; } && [ -z "$diffs" ]; then
        diffs="a new silent wrong: the bitstream builds and the netlist fails${notes:+ ($notes)}"; notes=""
    fi
    # a file:line that the today column quotes has to be in what the stages printed
    for t in $(grep -oE '[A-Za-z0-9_]+\.(sv|svh|v):[0-9]+' <<< "$today" || true); do
        grep -sqE "(^|[^A-Za-z0-9_])${t//./\\.}([^0-9]|$)" "$P/rtl.log" "$P/bit.log" "$P/net.log" \
            || diffs="${diffs:+$diffs; }expect.tsv says $t, no stage printed it"
    done
    # and so does every message it quotes, word for word (a quote may leave text out with ...)
    while IFS= read -r q; do
        grep -sqF -- "$q" "$P/rtl.log" "$P/bit.log" "$P/net.log" || diffs="${diffs:+$diffs; }expect.tsv quotes '$q', no stage printed it"
    done < <(quotes "$today")
    n=$((n+1)); [ $syn = pass ] && nsyn=$((nsyn+1))
    all=0; [ "$rtl$syn$net$bit" = passpasspasspass ] && all=1 && nall=$((nall+1))
    [ "$vivado" = supported ] && { nsup=$((nsup+1)); nsupall=$((nsupall+all)); }
    gap=0; if { [ "$vivado" = supported ] && [ $all = 0 ]; } || [ $silent = 1 ]; then gap=1; fi
    line=$(printf '%-28s rtl %-4s  synth %-4s  netlist %-4s  bit %-4s' "$id" "$rtl" "$syn" "$net" "$bit")
    if [ -z "$diffs" ]; then
        nok=$((nok+1)); msg=${notes:+note: $notes}
        if [ $gap = 1 ]; then verdict=gap; ngap=$((ngap+1)); else verdict=ok; fi
        printf '  %-4s %s%s\n' "$verdict" "$line" "${msg:+   $msg}"
    else
        verdict=bad; msg=$diffs
        echo "  BAD  $line   $msg"
        for s in rtl:$rtl net:$net bit:$bit; do    # the first error line of each stage that did not pass
            [ "${s#*:}" = fail ] || continue
            printf '         %-7s %s\n' "${s%%:*}:" "$(first_err "$P/${s%%:*}.log")"
        done
    fi
    [ -z "${SV_OUT:-}" ] || printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$verdict" "$rtl" "$syn" "$net" "$bit" "$msg" >> "$SV_OUT"
done
score="synthesis $nsyn/$n, all four stages $nall/$n, Vivado-supported probes passing all four stages $nsupall/$nsup, known gaps $ngap"
echo "$score"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "SystemVerilog probes (yosys $YV, iverilog $IV): $score" >> "$GITHUB_STEP_SUMMARY"
echo "matches expect.tsv: $nok/$n"
[ $nok -eq $n ]
