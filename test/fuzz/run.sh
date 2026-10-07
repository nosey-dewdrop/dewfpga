#!/usr/bin/env bash
# Random SystemVerilog designs (gen.py) through the product, each in its own folder:
#   test/fuzz/run.sh <first seed> <count>        JOBS=3 runs seeds in parallel; KEEP=1 keeps every folder
# Per seed: dewfpga sim (the RTL, iverilog) and dewfpga bit (the netlist and the bitstream), then the netlist
# simulated the way test/sv/run.sh does it (yosys read_json; write_verilog; iverilog with yosys' xilinx
# cells_sim.v and the same testbench) and the two output traces compared line by line: a bit the RTL knows
# (0 or 1) must be the same in the netlist; an x in the RTL matches anything (a register nobody started).
# Outcomes: ok (built, RTL == netlist) / silent-wrong (built, RTL != netlist: the board would not do what the
# simulation showed) / refused-coded (dewfpga bit failed with an ERROR [code]) / refused-uncoded (failed
# without one) / crash (a tool aborted, a timeout, or the netlist cannot be simulated) / sim-refused (dewfpga
# sim failed, or iverilog could not compile the RTL and the sim ran on the build's view: there is no
# independent reference then). Outcome and the first message per seed in results.tsv; a failed seed's folder
# stays. The last line is the metric the later updates read.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
export HERE; export CLI="$ROOT/bin/dewfpga" GEN="$HERE/gen.py" LC_ALL=C LC_CTYPE=C LANG=C
export CELLS="$(yosys-config --datdir)/xilinx/cells_sim.v"
[ -s "$CELLS" ] || { echo "ERROR: $CELLS not found" >&2; exit 1; }
[ $# -eq 2 ] || { echo "usage: run.sh <first seed> <count>" >&2; exit 2; }
first=$1 count=$2
export W="${FUZZ_OUT:-$(mktemp -d)}"; mkdir -p "$W"
export KEEP="${KEEP:-}" TIMEOUT="${TIMEOUT:-30}" BIT_TIMEOUT="${BIT_TIMEOUT:-150}"
echo "fuzz: seeds $first..$((first+count-1)), work $W"

run_one() {
    local seed=$1 out="" msg="" rc d; d="$W/s$seed"
    rm -rf "$d"; mkdir -p "$d"
    tmo() { perl -e '$SIG{ALRM}=sub{kill TERM=>$p; select(undef,undef,undef,0.3); kill KILL=>$p; exit 142}; alarm shift; $p=fork; exec @ARGV if !$p; waitpid $p,0; exit($?>>8)' "$@"; }
    firstmsg() { grep -m1 -E 'ERROR|error|sorry|Assertion|Segmentation|abort|TIMEOUT|MISMATCH' "$1" | cut -c1-300 || true; }
    python3 "$GEN" "$seed" "$d" || { echo "$seed	gen-fail	generator failed" >> "$W/results.tsv"; return; }
    # 1 the RTL
    rc=0; (cd "$d" && SIM_TIMEOUT=$TIMEOUT "$CLI" sim) > "$d/sim.log" 2>&1 || rc=$?
    if [ $rc -ne 0 ] || grep -q 'note \[sim-from-build\]' "$d/sim.log"; then
        out=sim-refused; msg=$(grep -m1 -E 'ERROR|error|sorry|internal' "$d/sim.log" | cut -c1-300)
    else
        grep -E '^[0-9]+ ' "$d/top_sim.out" > "$d/rtl.trace"
        # 2 the bitstream
        rc=0; (cd "$d" && tmo "$BIT_TIMEOUT" "$CLI" bit) > "$d/bit.log" 2>&1 || rc=$?
        if [ $rc -eq 142 ]; then out=crash; msg="dewfpga bit did not finish in $BIT_TIMEOUT s"
        elif [ $rc -ne 0 ] || [ ! -s "$d/top.bit" ]; then
            if grep -qE 'ERROR \[[a-z0-9-]+\]' "$d/bit.log"; then out=refused-coded; msg=$(grep -m1 -oE '([A-Za-z0-9_.]+:[0-9]+: )?ERROR \[[a-z0-9-]+\]: .{0,200}' "$d/bit.log")
            elif grep -qiE 'Assertion|Segmentation|abort|dumped|internal error' "$d/bit.log"; then out=crash; msg=$(firstmsg "$d/bit.log")
            else out=refused-uncoded; msg=$(firstmsg "$d/bit.log"); fi
        else
            # 3 the netlist, as test/sv/run.sh simulates it
            rc=0; (cd "$d" && yosys -q -p "read_json top.json; write_verilog -noattr net.v" && iverilog -g2012 -s tb -o net.vvp net.v top_tb.sv "$CELLS" && tmo "$TIMEOUT" vvp -n -l net.out net.vvp) > "$d/net.log" 2>&1 || rc=$?
            if [ $rc -ne 0 ]; then out=crash; msg="netlist simulation: $( [ $rc -eq 142 ] && echo "did not finish in $TIMEOUT s" || firstmsg "$d/net.log")"
            else
                grep -E '^[0-9]+ ' "$d/net.out" > "$d/net.trace"
                if python3 "$HERE/compare.py" "$d/rtl.trace" "$d/net.trace" > "$d/compare.log" 2>&1; then out=ok
                else out=silent-wrong; msg=$(head -1 "$d/compare.log"); fi
            fi
        fi
    fi
    printf '%s\t%s\t%s\n' "$seed" "$out" "$msg" >> "$W/results.tsv"
    echo "  s$seed	$out	$msg"
    if [ "$out" = ok ] && [ -z "$KEEP" ]; then rm -rf "$d"; fi
}
export -f run_one
: > "$W/results.tsv"
seq "$first" $((first + count - 1)) | xargs -P "${JOBS:-1}" -n1 bash -c 'run_one "$1"' _
n=$(wc -l < "$W/results.tsv" | tr -d ' ')
c() { awk -F'\t' -v o="$1" '$2==o' "$W/results.tsv" | wc -l | tr -d ' '; }
echo "fuzz: ok $(c ok) of $n; silent-wrong $(c silent-wrong); refused-coded $(c refused-coded); refused-uncoded $(c refused-uncoded); crash $(c crash); sim-refused $(c sim-refused)"
