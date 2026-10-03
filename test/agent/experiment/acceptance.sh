#!/usr/bin/env bash
# Acceptance for one experiment run, by the root session, never by the agent (this tree is outside the agent's folder):
#   test/agent/experiment/acceptance.sh <run-dir> <fixture>        e.g. ... "$RUNS"/guided/4_dual_edge 4_dual_edge
# Copies the agent's sources once (no build output it left behind); every step below starts from a fresh copy of them.
# Each check prints 'PASS name' or 'FAIL name: why'; there is no SKIP:
#   xdc        exactly one .xdc, byte-identical to the fixture's (no re-pinning, no added command)
#   design     fixture 7 only: top.sv byte-identical to the fixture's (the task was a testbench, not a design change)
#   sim        dewfpga sim exits 0 with the agent's files
#   bit        dewfpga bit exits 0 and writes a .bit
#   tb-good    the agent's testbench (the files holding a port-less module) passes on the reference design
#   tb-wrong   ... and fails (dewfpga sim exit != 0) on every reference/<fixture>/wrong/*.sv: it still catches a wrong design
#   ref-tb     the reference testbench passes on the agent's design
#   ports      module top's ports (name, direction, width) in the agent's netlist equal the reference's
#   eqv        test/sv/eqv.sh: the agent's netlist against the reference RTL; any exit but 0 is a FAIL
# Exit 0 when every check passes. Needs the toolchain (dewfpga check).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
DEWFPGA=${DEWFPGA:-$ROOT/bin/dewfpga}
[ $# -eq 2 ] || { echo "usage: acceptance.sh <run-dir> <fixture>" >&2; exit 2; }
run=$1; fx=$2
fixture="$HERE/fixtures/$fx"; ref="$HERE/reference/$fx"
[ -d "$run" ] && [ -d "$fixture" ] && [ -d "$ref" ] || { echo "no such run or fixture: $run $fx" >&2; exit 2; }
W=$(mktemp -d "${TMPDIR:-/tmp}/dewfpga-accept.XXXXXX"); trap 'rm -rf "$W"' EXIT
fails=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: $2"; fails=$((fails + 1)); }
first_error() { grep -m1 'ERROR' "$1" | cut -c1-160; }
fresh() { rm -rf "${W:?}/$1"; mkdir -p "$W/$1"; }               # a new, empty work folder: no output of an earlier step
is_tb() { grep -qE '^[[:space:]]*module[[:space:]]+[A-Za-z_][A-Za-z0-9_$]*[[:space:]]*(\([[:space:]]*\))?[[:space:]]*;' "$1"; }
sim_in() { (cd "$W/$1" && "$DEWFPGA" sim > "$W/$1.out" 2>&1); }

# the agent's sources only, kept read-only in src/
mkdir -p "$W/src"
find "$run" -maxdepth 1 -type f \( -name '*.sv' -o -name '*.v' -o -name '*.svh' -o -name '*.xdc' \) -exec cp {} "$W/src/" \;
tbs=(); designs=()
for f in "$W/src"/*.sv "$W/src"/*.v; do [ -f "$f" ] || continue; if is_tb "$f"; then tbs+=("$f"); else designs+=("$f"); fi; done

xdcs=("$W/src"/*.xdc)
if [ ${#xdcs[@]} -eq 1 ] && [ -f "${xdcs[0]}" ] && cmp -s "${xdcs[0]}" "$fixture/top.xdc"; then pass xdc
else fail xdc "want exactly one .xdc, byte-identical to fixtures/$fx/top.xdc (found ${#xdcs[@]})"; fi

if [ ! -e "$fixture/tb.sv" ]; then
    if cmp -s "$W/src/top.sv" "$fixture/top.sv"; then pass design; else fail design "top.sv differs from the fixture's"; fi
fi

fresh a; cp "$W/src"/* "$W/a/"
if sim_in a; then pass sim; else fail sim "$(first_error "$W/a.out")"; fi
fresh b; cp "$W/src"/* "$W/b/"
if (cd "$W/b" && "$DEWFPGA" bit > "$W/b.out" 2>&1) && ls "$W/b"/*.bit > /dev/null 2>&1; then pass bit; else fail bit "$(first_error "$W/b.out")"; fi

# the agent's testbench: right on the reference design, and wrong on every known-wrong design
if [ ${#tbs[@]} -eq 0 ]; then fail tb-good "no file with a port-less module"; fail tb-wrong "no testbench"
else
    fresh g; cp "${tbs[@]}" "$ref/top.sv" "$fixture/top.xdc" "$W/g/"
    if sim_in g; then pass tb-good; else fail tb-good "on the reference design: $(first_error "$W/g.out")"; fi
    missed=""; n=0
    for m in "$ref"/wrong/*.sv; do
        [ -f "$m" ] || continue
        n=$((n + 1)); fresh m; cp "${tbs[@]}" "$fixture/top.xdc" "$W/m/"; cp "$m" "$W/m/top.sv"
        sim_in m && missed="$missed $(basename "$m" .sv)"
    done
    if [ "$n" -eq 0 ]; then fail tb-wrong "reference/$fx/wrong/ holds no design"
    elif [ -z "$missed" ]; then pass tb-wrong; else fail tb-wrong "passes on the wrong design(s):$missed"; fi
fi

# the reference testbench on the agent's design files
fresh r; [ ${#designs[@]} -gt 0 ] && cp "${designs[@]}" "$W/r/"; cp "$W/src"/*.svh "$W/r/" 2>/dev/null; cp "$ref/tb.sv" "$fixture/top.xdc" "$W/r/"
if sim_in r; then pass ref-tb; else fail ref-tb "$(first_error "$W/r.out")"; fi

# ports and equivalence: the agent's netlist (from the bit step) against the reference's
if [ -f "$W/b/top.json" ]; then
    fresh ref; cp "$ref/top.sv" "$fixture/top.xdc" "$W/ref/"
    if (cd "$W/ref" && "$DEWFPGA" bit > "$W/ref.out" 2>&1) && [ -f "$W/ref/top.json" ]; then
        ports() { python3 - "$1" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
m = d["modules"]["top"]
for n, p in sorted(m["ports"].items()):
    print(n, p["direction"], len(p["bits"]))
PY
        }
        if diff <(ports "$W/b/top.json") <(ports "$W/ref/top.json") > "$W/ports.diff"; then pass ports; else fail ports "$(tr '\n' ';' < "$W/ports.diff" | cut -c1-160)"; fi
        # eqv.sh compares a netlist with the RTL in the folder it runs in: the reference RTL here, the agent's netlist
        cp "$W/b/top.json" "$W/ref/agent.json"
        (cd "$W/ref" && "$ROOT/test/sv/eqv.sh" agent.json > "$W/eqv.out" 2>&1); rc=$?
        if [ $rc -eq 0 ]; then pass eqv; else fail eqv "eqv.sh exit $rc: $(grep -m1 -E 'EQV|error|ERROR' "$W/eqv.out" | cut -c1-140)"; fi
    else
        fail ports "the reference did not build: $(first_error "$W/ref.out")"; fail eqv "no reference netlist"
    fi
else
    fail ports "no top.json from the agent's build"; fail eqv "no top.json from the agent's build"
fi
echo "result $fx: $fails failed"
[ "$fails" -eq 0 ]
