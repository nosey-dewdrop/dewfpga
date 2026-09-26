#!/usr/bin/env bash
# The netlist stage's comparison with the RTL, run in a probe's work folder:
#   test/sv/eqv.sh <netlist.json>
# The netlist (every module renamed, module top_net, started as the board starts it: eqv.py --netlist) against
# the RTL (module top, from the folder's design files) on eqv.py's bench. Exit 0 and 'EQV PASS' = equal;
# exit 2 = skipped, iverilog cannot compile the RTL; anything else = fail. run.sh runs it on the product's
# netlist and eqv_check.sh on netlists that differ from their RTL in one known way, so the checks of the bench
# run this same copy: the RTL's register listing below included.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TIMEOUT=${TIMEOUT:-30}           # seconds; the netlist of an async-load loop never reaches $finish
CELLS="$(yosys-config --datdir)/xilinx/cells_sim.v"
[ $# -eq 1 ] || { echo "usage: eqv.sh <netlist.json>" >&2; exit 1; }
json=$1
tmo() { perl -e '$SIG{ALRM}=sub{kill TERM=>$p; select(undef,undef,undef,0.3); kill KILL=>$p; exit 142}; alarm shift; $p=fork; exec @ARGV if !$p; waitpid $p,0; exit($?>>8)' "$TIMEOUT" "$@"; }
# the folder's design files, packages and interfaces first (iverilog needs them before use)
rtl_files() {
    local f first="" rest=""
    for f in *.sv *.v; do
        [ -f "$f" ] || continue
        case $f in tb.sv|net.v|net_eqv.v|eqv.sv) continue ;; esac
        if grep -qE '^[[:space:]]*(package|interface)[[:space:]]' "$f" && ! grep -qE '^[[:space:]]*module[[:space:]]' "$f"
        then first="$first $f"; else rest="$rest $f"; fi
    done
    echo "$first $rest"
}
rtl=$(rtl_files)
if ! { python3 "$HERE/eqv.py" --netlist "$json" > net_eqv.json && yosys -q -p "read_json net_eqv.json; write_verilog -noattr net_eqv.v"; }; then
    echo "EQV FAIL: could not write the netlist for the bench"; exit 1
fi
grep -q '^module top_net(' net_eqv.v || { echo "EQV FAIL: net_eqv.v has no 'module top_net('"; exit 1; }
# the RTL's registers and their resets, so the bench starts them as the board does (eqv.py rtl_starts);
# flatten brings a submodule's registers into top, where rtl_starts looks for them
# shellcheck disable=SC2086   # file names without spaces
yosys -q -p "read_verilog -sv $rtl; hierarchy -top top; proc; flatten; memory_collect; opt_dff; write_json rtl_regs.json" > rtl_regs.log 2>&1 \
    || { cat rtl_regs.log; echo "EQV FAIL: yosys could not list the RTL's registers"; exit 1; }
python3 "$HERE/eqv.py" "$json" rtl_regs.json > eqv.sv || { echo "EQV FAIL: eqv.py could not write the bench"; exit 1; }
# shellcheck disable=SC2086   # file names without spaces
bench() { iverilog -g2012 -s eqv -o eqv.vvp $rtl net_eqv.v eqv.sv "$CELLS" > eqv_build.log 2>&1; }
built=0; bench && built=1
# a register that shares its variable with an assign (led[3:0] <= ...; assign led[15:4] = sw[15:4]) cannot be
# started whole: iverilog names each such variable, and the bench is written again to start them bit by bit
if [ $built = 0 ]; then
    part=$(sed -n "s/.*procedural assignment to variable 'eqv_rtl\.\([^']*\)' because it is also continuously assigned.*/\1/p" eqv_build.log | sort -u | paste -sd, -)
    if [ -n "$part" ]; then
        python3 "$HERE/eqv.py" --bits "$part" "$json" rtl_regs.json > eqv.sv || { echo "EQV FAIL: eqv.py could not write the bench"; exit 1; }
        bench && built=1
    fi
fi
if [ $built = 0 ]; then
    # shellcheck disable=SC2086
    if iverilog -g2012 -s top -o /dev/null $rtl "$CELLS" > /dev/null 2>&1; then
        cat eqv_build.log; echo "EQV FAIL: the RTL compiles but the equivalence bench does not"; exit 1
    fi
    echo "EQV SKIP: iverilog cannot compile the RTL, so only the testbench checked the netlist"; exit 2
fi
tmo vvp -n eqv.vvp
