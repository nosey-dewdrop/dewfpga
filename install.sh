#!/usr/bin/env bash
# dewfpga install: Basys3 (XC7A35T) toolchain on macOS Apple Silicon, no Vivado.
#
#   SystemVerilog -> yosys -> nextpnr-xilinx -> prjxray -> openFPGALoader -> Basys3
#
# One command. Safe to re-run: finished steps are skipped.
# Everything goes under $FPGA_HOME (default ~/fpga). System Python is never touched.
#
# Usage:  ./install.sh            (or: dewfpga install)
#         FPGA_HOME=/elsewhere ./install.sh
set -euo pipefail

export FPGA_HOME="${FPGA_HOME:-$HOME/fpga}"
# -j3 is safe on 8 GB RAM (more swaps); on 16 GB+ use all cores.
if [ -z "${JOBS:-}" ]; then
    if [ "$(sysctl -n hw.memsize 2>/dev/null || echo 0)" -ge $((16*1024*1024*1024)) ]; then JOBS=$(sysctl -n hw.ncpu); else JOBS=3; fi
fi
DEVICE="xc7a35tcpg236-1"                # Basys3
CHIPDB_NAME="xc7a35t"

# Pinned sources: the LED lit with exactly these commits on 2026-09-19.
NEXTPNR_URL="https://github.com/openXC7/nextpnr-xilinx.git"
NEXTPNR_SHA="3fd78784c7788f93f276358edf5477221cc6c179"
PRJXRAY_URL="https://github.com/f4pga/prjxray.git"
PRJXRAY_SHA="c9f02d8576042325425824647ab5555b1bc77833"

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
    if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$sha" ]; then
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
    ok "$dir @ ${sha:0:7} (+submodule)"
}

# ---------------------------------------------------------------- 0. environment
step 0 "Environment"
[ "$(id -u)" -ne 0 ] || die "do not run with sudo. Everything installs as your user under ~/fpga."
[ "$(uname -s)" = Darwin ] || die "this script is for macOS. Linux/Windows are not supported."
[ "$(uname -m)" = arm64 ]  || die "only Apple Silicon (arm64) is tested. Intel Mac not yet."
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools missing. First:  xcode-select --install   (then run this again)"
command -v brew >/dev/null   || die "Homebrew missing. First:  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"   (https://brew.sh)"
mkdir -p "$FPGA_HOME"
FREE_GB=$(df -g "$FPGA_HOME" | awk 'NR==2{print $4}')
[ "$FREE_GB" -ge 4 ] || die "only $FREE_GB GB free; the install needs 1.4 GB plus build scratch, at least 4 GB."
LOG="$FPGA_HOME/install.log"
exec > >(tee -a "$LOG") 2>&1
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
echo "    $(yosys -V | cut -d' ' -f1-2) · openFPGALoader $(openFPGALoader --Version 2>&1 | head -1 | awk '{print $NF}') · $(iverilog -V 2>&1 | head -1 | cut -d' ' -f1-4) · $(cmake --version | head -1)"
PY3="$BREW_PREFIX/opt/python@3.14/bin/python3.14"
[ -x "$PY3" ] || die "python@3.14 not found: $PY3"

# ---------------------------------------------------------------- 2. nextpnr-xilinx
# oss-cad-suite does NOT ship nextpnr-xilinx (497 MB wasted). Build from source.
step 2 "nextpnr-xilinx (from source, ~2 min)"
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
    "$VENV/bin/pip" install -q --upgrade pip
    "$VENV/bin/pip" install -q "${PIP_PKGS[@]}"
    ok "${PIP_PKGS[*]}"
fi

# ---------------------------------------------------------------- 4. prjxray
step 4 "prjxray (fasm2frames + xc7frames2bit, ~2 min)"
PRJXRAY_DIR="$FPGA_HOME/prjxray"
clone_pinned "$PRJXRAY_URL" "$PRJXRAY_SHA" "$PRJXRAY_DIR"
if "$VPY" -c "import prjxray" 2>/dev/null; then
    skip "prjxray python package"
else
    "$VENV/bin/pip" install -q -e "$PRJXRAY_DIR"
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
if [ -s "$CHIPDB_BIN" ]; then
    skip "$CHIPDB_BIN"
else
    mkdir -p "$CHIPDB_DIR"
    BBA="$CHIPDB_DIR/$CHIPDB_NAME.bba"
    ( cd "$NEXTPNR_DIR" && "$VPY" xilinx/python/bbaexport.py \
        --xray xilinx/external/prjxray-db/artix7 \
        --metadata xilinx/external/nextpnr-xilinx-meta/artix7 \
        --device "$DEVICE" --constids xilinx/constids.inc --bba "$BBA" )
    "$NEXTPNR_DIR/build/bbasm" --l "$BBA" "$CHIPDB_BIN"
    rm -f "$BBA"                         # 268 MB intermediate; .bin is all we need
    ok "$CHIPDB_BIN ($(du -h "$CHIPDB_BIN" | cut -f1))"
fi

# ---------------------------------------------------------------- 6. verify
step 6 "Verify"
CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/dewfpga"
BIN_DIR="$BREW_PREFIX/bin"                 # Apple Silicon brew: user-writable, on PATH
if [ "$(readlink -f "$(command -v dewfpga 2>/dev/null || echo /nonexistent)")" = "$CLI" ]; then
    skip "dewfpga on PATH ($(command -v dewfpga))"          # npm -g or an earlier link
elif [ -w "$BIN_DIR" ]; then
    ln -sfn "$CLI" "$BIN_DIR/dewfpga" && ok "dewfpga -> $BIN_DIR/dewfpga (on PATH)"
else
    echo "    $BIN_DIR not writable; add to PATH:  export PATH=\"$(dirname "$CLI"):\$PATH\""
fi
"$CLI" check
echo
echo "Total: $(( ($(date +%s) - T0) / 60 )) min. Log: $LOG"
echo "Next:  dewfpga new blink && cd blink && dewfpga flash"
