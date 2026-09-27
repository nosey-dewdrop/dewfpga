#!/usr/bin/env bash
# dewfpga install: Basys3 (XC7A35T) toolchain on macOS Apple Silicon, no Vivado.
#
#   SystemVerilog -> yosys (+ yosys-slang) -> nextpnr-xilinx -> prjxray -> openFPGALoader -> Basys3
#
# One command. Safe to re-run: finished steps are skipped.
# Everything goes under $FPGA_HOME (default ~/fpga). System Python is never touched.
# Steps: 0 environment, 1 Homebrew packages, 2 nextpnr-xilinx, 3 Python venv, 4 prjxray,
#        5 chipdb, 6 yosys-slang (the SystemVerilog reader plugin for yosys), 7 verify.
#
# Usage:  ./install.sh            (or: dewfpga install)
#         FPGA_HOME=/elsewhere ./install.sh
#         ./install.sh --help
set -euo pipefail
case "${1:-}" in -h|--help|help) sed -n '2,13s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"; exit 0 ;; esac

export FPGA_HOME="${FPGA_HOME:-$HOME/fpga}"
# one compile job per ~3 GB of RAM (a nextpnr object peaks near that), never more than the cores. 8 GB -> 2 jobs.
if [ -z "${JOBS:-}" ]; then
    MEM_GB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )); NCPU=$(sysctl -n hw.ncpu 2>/dev/null || echo 4)
    JOBS=$(( MEM_GB / 3 )); [ "$JOBS" -ge 1 ] || JOBS=1; [ "$JOBS" -le "$NCPU" ] || JOBS=$NCPU
fi
DEVICE="xc7a35tcpg236-1"                # Basys3
CHIPDB_NAME="xc7a35t"

# Pinned sources: the LED lit with exactly these commits on 2026-09-19.
NEXTPNR_URL="https://github.com/openXC7/nextpnr-xilinx.git"
NEXTPNR_SHA="3fd78784c7788f93f276358edf5477221cc6c179"
PRJXRAY_URL="https://github.com/f4pga/prjxray.git"
PRJXRAY_SHA="c9f02d8576042325425824647ab5555b1bc77833"
# yosys-slang: the brew yosys 0.69 has no read_slang ("No such command or cell type: read_slang"), the plugin adds it.
SLANG_URL="https://github.com/povik/yosys-slang.git"
SLANG_SHA="96767863835f3c862cea9c63052b2ce9d0b55884"

BREW_PKGS=(yosys openfpgaloader icarus-verilog cmake ninja eigen pkg-config python@3.14)
# Versions that worked on 2026-09-19. Brew packages can't be pinned (tested with yosys 0.69, openFPGALoader 1.1.1, iverilog 13.0).
PIP_PKGS=(fasm==0.0.2.post88 pyyaml==6.0.3 textx==4.4.0 simplejson==4.1.2 intervaltree==3.2.1 numpy==2.5.3 pyjson5==2.0.1)

# ---------------------------------------------------------------- helpers
T0=$(date +%s)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then B=$'\033[1m' G=$'\033[32m' Y=$'\033[33m' R=$'\033[31m' N=$'\033[0m'; else B='' G='' Y='' R='' N=''; fi
step()  { printf '\n%s[%s] %s%s  (+%ds)\n' "$B" "$1" "$2" "$N" "$(( $(date +%s) - T0 ))"; }
ok()    { printf '    %s✓%s %s\n' "$G" "$N" "$*"; }
skip()  { printf '    %s↷%s %s (already there, skipped)\n' "$Y" "$N" "$*"; }
die()   { printf '\n%sERROR:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# Shallow-fetch one pinned commit. Same source even after the branch moves on.
clone_pinned() {  # <url> <sha> <dir>
    local url=$1 sha=$2 dir=$3
    # the stamp is written after the submodules, so a clone interrupted half-way is redone, not skipped
    if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$sha" ] && [ "$(cat "$dir/.dewfpga-sha" 2>/dev/null)" = "$sha" ]; then
        skip "$dir @ ${sha:0:7}"; return
    fi
    rm -rf "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
    git -C "$dir" fetch -q --depth 1 origin "$sha" \
        || die "could not fetch $url (no network? can you reach GitHub?)"
    git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
    # --recursive is REQUIRED: prjxray's yaml-cpp/googletest/abseil are submodules; cmake fails without them.
    git -C "$dir" submodule update -q --init --recursive --depth 1
    echo "$sha" > "$dir/.dewfpga-sha"
    ok "$dir @ ${sha:0:7} (+submodule)"
}

# ---------------------------------------------------------------- 0. environment
step 0 "Environment"
[ "$(id -u)" -ne 0 ] || die "do not run with sudo. Everything installs as your user under ~/fpga."
[ "$(uname -s)" = Darwin ] || die "this script is for macOS. Linux/Windows are not supported."
[ "$(uname -m)" = arm64 ]  || die "only Apple Silicon (arm64) is tested. Intel Mac not yet."
[[ $FPGA_HOME != *[[:space:]]* ]] || die "FPGA_HOME=$FPGA_HOME contains a space; the FPGA tools cannot handle that path."
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools missing. First:  xcode-select --install   (then run this again)"
command -v brew >/dev/null   || die "Homebrew missing. First:  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"   (https://brew.sh)"
mkdir -p "$FPGA_HOME"
FREE_GB=$(df -g "$FPGA_HOME" | awk 'NR==2{print $4}')
[ "$FREE_GB" -ge 4 ] || die "only $FREE_GB GB free; the install needs 1.4 GB plus build scratch, at least 4 GB."
LOG="$FPGA_HOME/install.log"
exec > >(tee >(sed -u 's/\x1b\[[0-9;]*m//g' >> "$LOG")) 2>&1     # the log gets the text without colour codes
echo "    FPGA_HOME=$FPGA_HOME   JOBS=$JOBS   log: $LOG"
echo "    $(date)  $(sw_vers -productVersion)  $(uname -m)"

# ---------------------------------------------------------------- 1. brew
step 1 "Homebrew packages"
missing=()
for p in "${BREW_PKGS[@]}"; do
    brew list --formula "$p" >/dev/null 2>&1 && skip "$p" || missing+=("$p")
done
if [ ${#missing[@]} -gt 0 ]; then
    brew install "${missing[@]}"
    ok "${missing[*]}"
fi
BREW_PREFIX="$(brew --prefix)"
YV=$(yosys -V 2>/dev/null | awk '{print $2}' | cut -d+ -f1)
[ "$(printf '%s\n0.69\n' "$YV" | sort -V | head -1)" = "0.69" ] || echo "    ${Y}note${N}: yosys $YV is older than the 0.69 this chain was tested with; brew upgrade yosys if a build fails"
echo "    $(yosys -V | cut -d' ' -f1-2) · openFPGALoader $(openFPGALoader --Version 2>&1 | head -1 | awk '{print $NF}') · $(iverilog -V 2>&1 | head -1 | cut -d' ' -f1-4) · $(cmake --version | head -1)"
PY3="$BREW_PREFIX/opt/python@3.14/bin/python3.14"
[ -x "$PY3" ] || die "python@3.14 not found: $PY3"

# ---------------------------------------------------------------- 2. nextpnr-xilinx
# oss-cad-suite does NOT ship nextpnr-xilinx (497 MB wasted). Build from source.
step 2 "nextpnr-xilinx (from source, ~1.5 min)"
NEXTPNR_DIR="$FPGA_HOME/nextpnr-xilinx"
clone_pinned "$NEXTPNR_URL" "$NEXTPNR_SHA" "$NEXTPNR_DIR"
if [ -x "$NEXTPNR_DIR/build/nextpnr-xilinx" ] && [ -x "$NEXTPNR_DIR/build/bbasm" ]; then
    skip "nextpnr-xilinx binary"
else
    # USE_OPENMP=OFF is REQUIRED: Apple clang has no -fopenmp; cmake fails otherwise.
    cmake -S "$NEXTPNR_DIR" -B "$NEXTPNR_DIR/build" -G Ninja \
          -DARCH=xilinx -DCMAKE_BUILD_TYPE=Release \
          -DUSE_OPENMP=OFF -DBUILD_GUI=OFF -DBUILD_PYTHON=OFF -DBUILD_TESTS=OFF
    ninja -C "$NEXTPNR_DIR/build" -j"$JOBS" nextpnr-xilinx bbasm
    ok "nextpnr-xilinx + bbasm built"
fi

# ---------------------------------------------------------------- 3. venv
# PEP 668: pip install into Homebrew Python is refused -> venv required.
step 3 "Python venv"
VENV="$FPGA_HOME/venv"
VPY="$VENV/bin/python"
# a brew Python upgrade breaks the old venv's symlink ("dead venv"); rebuild if it doesn't run.
if [ -x "$VPY" ] && ! "$VPY" -c "import sys" >/dev/null 2>&1; then
    echo "    venv is broken (Python upgraded?), rebuilding"; rm -rf "$VENV"
fi
[ -x "$VPY" ] || "$PY3" -m venv "$VENV"
if "$VPY" -c "import fasm, yaml, textx, simplejson, intervaltree" 2>/dev/null; then
    skip "fasm pyyaml textx simplejson intervaltree"
else
    "$VENV/bin/pip" install -q "${PIP_PKGS[@]}"
    ok "${PIP_PKGS[*]}"
fi
# a changed pin list re-installs: the check above only sees that the modules import
if [ "$(cat "$VENV/.pins" 2>/dev/null)" != "${PIP_PKGS[*]}" ]; then
    "$VENV/bin/pip" install -q "${PIP_PKGS[@]}" && echo "${PIP_PKGS[*]}" > "$VENV/.pins" && ok "python packages at the pinned versions"
fi

# ---------------------------------------------------------------- 4. prjxray
step 4 "prjxray (fasm2frames + xc7frames2bit, ~2 min)"
PRJXRAY_DIR="$FPGA_HOME/prjxray"
clone_pinned "$PRJXRAY_URL" "$PRJXRAY_SHA" "$PRJXRAY_DIR"
if "$VPY" -c "import prjxray" 2>/dev/null; then
    skip "prjxray python package"
else
    "$VENV/bin/pip" install -q --no-deps -e "$PRJXRAY_DIR"      # --no-deps: its setup.py must not move the pins above
    ok "prjxray python package (editable)"
fi
if [ -x "$PRJXRAY_DIR/build/tools/xc7frames2bit" ]; then
    skip "xc7frames2bit"
else
    # CMAKE_POLICY_VERSION_MINIMUM=3.5 is REQUIRED: prjxray uses old cmake syntax
    # that cmake 4.x refuses without it.
    cmake -S "$PRJXRAY_DIR" -B "$PRJXRAY_DIR/build" \
          -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
          -DPRJXRAY_BUILD_TESTING=OFF
    cmake --build "$PRJXRAY_DIR/build" --target xc7frames2bit -j"$JOBS"
    ok "xc7frames2bit built"
fi

# ---------------------------------------------------------------- 5. chipdb
# nextpnr-xilinx ships no prebuilt chipdb; it is generated per device.
step 5 "chipdb ($DEVICE, ~1 min, ~900 MB RAM)"
CHIPDB_DIR="$FPGA_HOME/chipdb"
CHIPDB_BIN="$CHIPDB_DIR/$CHIPDB_NAME.bin"
# the chipdb is generated by this nextpnr checkout's exporter: a new NEXTPNR_SHA means a new chipdb
if [ -s "$CHIPDB_BIN" ] && [ "$(cat "$CHIPDB_DIR/.sha" 2>/dev/null)" = "$NEXTPNR_SHA" ]; then
    skip "$CHIPDB_BIN"
else
    mkdir -p "$CHIPDB_DIR"
    BBA="$CHIPDB_DIR/$CHIPDB_NAME.bba"
    ( cd "$NEXTPNR_DIR" && "$VPY" xilinx/python/bbaexport.py \
        --xray xilinx/external/prjxray-db/artix7 \
        --metadata xilinx/external/nextpnr-xilinx-meta/artix7 \
        --device "$DEVICE" --constids xilinx/constids.inc --bba "$BBA" )
    "$NEXTPNR_DIR/build/bbasm" -l "$BBA" "$CHIPDB_BIN"
    rm -f "$BBA"                         # 268 MB intermediate; .bin is all we need
    echo "$NEXTPNR_SHA" > "$CHIPDB_DIR/.sha"
    ok "$CHIPDB_BIN ($(du -h "$CHIPDB_BIN" | cut -f1))"
fi

# ---------------------------------------------------------------- 6. yosys-slang
# The plugin is compiled against the brew yosys's headers (yosys-config), so it is rebuilt when brew
# moves yosys: the stamp next to slang.so holds the `yosys -V` line it was built for.
# A rebuild never removes the slang.so that works today: it compiles into build.new/ and build/ is
# replaced only once yosys loads the new .so. A build that fails (no disk, no network, a compiler error)
# leaves the earlier plugin in place, and the next  dewfpga install  resumes in build.new/.
step 6 "yosys-slang (SystemVerilog reader plugin, from source, ~3 min)"
SLANG_DIR="$FPGA_HOME/yosys-slang"
SLANG_SO="$SLANG_DIR/build/slang.so"
SLANG_STAMP="$SLANG_DIR/build/.dewfpga-yosys"
SLANG_NEW="$SLANG_DIR/build.new"
clone_pinned "$SLANG_URL" "$SLANG_SHA" "$SLANG_DIR"
YOSYS_ID=$(yosys -V)
YOSYS_SHORT=$(cut -d' ' -f1-2 <<< "$YOSYS_ID")
# the one test a built plugin must pass. The help text is grepped: `yosys -p 'help read_slang'` exits 0 with no plugin loaded
# (grep without -q: with pipefail, -q would close the pipe early and yosys' SIGPIPE would count as a failed load)
slang_loads() { yosys -m "$1" -p 'help read_slang' 2>&1 | grep '^ *read_slang \[' >/dev/null; }
if [ -s "$SLANG_SO" ] && [ "$(cat "$SLANG_STAMP" 2>/dev/null)" = "$YOSYS_ID" ]; then
    skip "slang.so (built for $YOSYS_SHORT)"
elif [ -s "$SLANG_SO" ] && [ ! -e "$SLANG_STAMP" ] && slang_loads "$SLANG_SO"; then
    # a slang.so from before the stamp existed, or built by hand (section 3.6 of the manual): it passes the
    # same load test a fresh build must pass, so it is stamped for this yosys instead of built again
    echo "$YOSYS_ID" > "$SLANG_STAMP"
    ok "slang.so already loads in $YOSYS_SHORT (read_slang); stamped, not rebuilt"
else
    # cmake runs INSIDE the checkout (cmake -B build.new .): slang's cmake asks `git remote get-url origin` in
    # the current directory for the GitHub prefix of its boost download; from any other directory the download
    # is the bare 'MikePopoloski/regex.git' and the configure stops.
    # Not fatal: the five steps above are complete without it; dewfpga check shows the row MISSING and
    # dewfpga install retries only this step (the clone is stamped, the build is not).
    if ( cd "$SLANG_DIR" && cmake -B build.new . -DCMAKE_BUILD_TYPE=Release -DBUILD_AS_PLUGIN=ON \
                                  -DYOSYS_CONFIG="$BREW_PREFIX/bin/yosys-config" \
         && make -C build.new -j"$JOBS" ) \
       && slang_loads "$SLANG_NEW/slang.so"; then
        rm -rf "$SLANG_DIR/build" && mv "$SLANG_NEW" "$SLANG_DIR/build"
        echo "$YOSYS_ID" > "$SLANG_STAMP"
        ok "slang.so built, loads in $YOSYS_SHORT (read_slang)"
    elif [ -s "$SLANG_SO" ] && slang_loads "$SLANG_SO"; then
        printf '    %s✗%s yosys-slang did not rebuild for %s (the compiler lines above; log: %s). The slang.so built for %s is kept\n      at %s and dewfpga uses it as before; run  dewfpga install  again to retry only this step.\n' \
            "$R" "$N" "$YOSYS_SHORT" "$LOG" "$(cut -d' ' -f1-2 "$SLANG_STAMP" 2>/dev/null || echo 'an earlier yosys')" "$SLANG_SO"
    else
        printf '    %s✗%s yosys-slang did not build (the compiler lines above; log: %s). The rest of the chain is complete.\n      dewfpga check will show yosys-slang MISSING; run  dewfpga install  again to retry only this step.\n' "$R" "$N" "$LOG"
        [ ! -s "$SLANG_SO" ] || echo "      (the slang.so at $SLANG_SO does not load in $YOSYS_SHORT, so dewfpga check lists it but the reader will not run until a rebuild succeeds)"
    fi
fi

# ---------------------------------------------------------------- 7. verify
step 7 "Verify"
CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/dewfpga"
echo "$FPGA_HOME" > "$(dirname "$CLI")/../.fpga_home"       # the CLI reads this, so FPGA_HOME=/elsewhere sticks
BIN_DIR="$BREW_PREFIX/bin"                 # Apple Silicon brew: user-writable, on PATH
resolve() { local f=$1 d; while [ -L "$f" ]; do d=$(cd "$(dirname "$f")" && pwd); f=$(readlink "$f"); [[ $f = /* ]] || f="$d/$f"; done; printf '%s' "$f"; }
if [ "$(resolve "$(command -v dewfpga 2>/dev/null || echo /nonexistent)")" = "$CLI" ]; then
    skip "dewfpga on PATH ($(command -v dewfpga))"          # npm -g or an earlier link
elif [ -w "$BIN_DIR" ]; then
    ln -sfn "$CLI" "$BIN_DIR/dewfpga" && ok "dewfpga -> $BIN_DIR/dewfpga (on PATH)"
else
    echo "    $BIN_DIR not writable; add to PATH:  export PATH=\"$(dirname "$CLI"):\$PATH\""
fi
"$CLI" check
echo
echo "Total: $(( $(date +%s) - T0 )) s. Log: $LOG"
echo "Next:  dewfpga new blink && cd blink && dewfpga flash"
