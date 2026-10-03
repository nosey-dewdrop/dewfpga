#!/usr/bin/env bash
# Checks acceptance.sh itself, no agent: every solved folder (reference design + reference testbench + fixture .xdc;
# fixture 7: its own design) must pass; every wrong design, every unrepaired fixture and an .xdc with one changed byte must fail.
# Prints 'ok <case>' or 'BAD <case>' per case and 'self-test: N bad'; exit 0 when nothing is bad.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S=$(mktemp -d "${TMPDIR:-/tmp}/dewfpga-selftest.XXXXXX"); trap 'rm -rf "$S"' EXIT
bad=0
expect() {  # expect <pass|fail> <case> <folder> <fixture>
    if "$HERE/acceptance.sh" "$3" "$4" > "$S/$2.log" 2>&1; then got=pass; else got=fail; fi
    if [ "$got" = "$1" ]; then echo "ok $2 ($got)"; else echo "BAD $2: want $1, got $got"; sed 's/^/    /' "$S/$2.log"; bad=$((bad + 1)); fi
}
for d in "$HERE"/fixtures/*/; do
    fx=$(basename "$d"); ref="$HERE/reference/$fx"
    mkdir -p "$S/$fx.solved"; cp "$d/top.xdc" "$ref/tb.sv" "$S/$fx.solved/"
    if [ -e "$d/tb.sv" ]; then cp "$ref/top.sv" "$S/$fx.solved/"; else cp "$d/top.sv" "$S/$fx.solved/"; fi
    expect pass "$fx.solved" "$S/$fx.solved" "$fx"
    for m in "$ref"/wrong/*.sv; do
        c="$fx.wrong.$(basename "$m" .sv)"; mkdir -p "$S/$c"; cp "$d/top.xdc" "$ref/tb.sv" "$S/$c/"; cp "$m" "$S/$c/top.sv"
        expect fail "$c" "$S/$c" "$fx"
    done
    if [ "$fx" != 1_port_direction ] && [ "$fx" != 2_unnamed_instance ]; then   # 1 and 2: the CLI repairs these itself
        mkdir -p "$S/$fx.unrepaired"; cp "$d"/* "$S/$fx.unrepaired/"; rm -f "$S/$fx.unrepaired/README.md"
        expect fail "$fx.unrepaired" "$S/$fx.unrepaired" "$fx"
    fi
done
c=4_dual_edge.xdc-space; mkdir -p "$S/$c"; cp "$S/4_dual_edge.solved"/*.sv "$S/$c/"
sed '1s/ / /;1s/$/ /' "$HERE/fixtures/4_dual_edge/top.xdc" > "$S/$c/top.xdc"; expect fail "$c" "$S/$c" 4_dual_edge
c=7_no_testbench.design-edited; mkdir -p "$S/$c"; cp "$S/7_no_testbench.solved"/* "$S/$c/"; printf '\n' >> "$S/$c/top.sv"
expect fail "$c" "$S/$c" 7_no_testbench
echo "self-test: $bad bad"
[ "$bad" -eq 0 ]
