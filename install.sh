#!/usr/bin/env bash
# mac-fpga install — macOS Apple Silicon'da Vivado'suz Basys3 (XC7A35T) zinciri.
#
#   SystemVerilog -> yosys -> nextpnr-xilinx -> prjxray -> openFPGALoader -> Basys3
#
# Tek komut. Yeniden çalıştırmak güvenli: biten adım atlanır.
# Her şey $FPGA_HOME altına kurulur (varsayılan ~/fpga). Sistem Python'a dokunmaz.
#
# Kullanım:  ./install.sh            (ya da: mac-fpga install)
#            FPGA_HOME=/başka/yer ./install.sh
set -euo pipefail

export FPGA_HOME="${FPGA_HOME:-$HOME/fpga}"
JOBS="${JOBS:-3}"                       # 8 GB RAM'de -j3 güvenli; daha fazlası swap'e düşer
DEVICE="xc7a35tcpg236-1"                # Basys3
CHIPDB_NAME="xc7a35t"

# Sabitlenmiş kaynaklar — 19 Eyl 2026'da bu commit'lerle LED yandı.
NEXTPNR_URL="https://github.com/openXC7/nextpnr-xilinx.git"
NEXTPNR_SHA="3fd78784c7788f93f276358edf5477221cc6c179"
PRJXRAY_URL="https://github.com/f4pga/prjxray.git"
PRJXRAY_SHA="c9f02d8576042325425824647ab5555b1bc77833"

BREW_PKGS=(yosys openfpgaloader icarus-verilog cmake ninja eigen pkg-config python@3.14)
# 19 Eyl 2026'da çalışan sürümler. Brew paketleri sabitlenemez (yosys 0.69, openFPGALoader 1.1.1, iverilog 13.0 ile test edildi).
PIP_PKGS=(fasm==0.0.2.post88 pyyaml==6.0.3 textx==4.4.0 simplejson==4.1.2 intervaltree==3.2.1 numpy==2.5.3 pyjson5==2.0.1)

# ---------------------------------------------------------------- yardımcılar
T0=$(date +%s)
step()  { printf '\n\033[1m[%s] %s\033[0m  (+%ds)\n' "$1" "$2" "$(( $(date +%s) - T0 ))"; }
ok()    { printf '    \033[32m✓\033[0m %s\n' "$*"; }
skip()  { printf '    \033[33m↷\033[0m %s (zaten var, atlandı)\n' "$*"; }
die()   { printf '\n\033[31mHATA:\033[0m %s\n' "$*" >&2; exit 1; }

# Sabit bir commit'i sığ (depth 1) çek. Ana dal ilerlese de aynı kaynak gelir.
clone_pinned() {  # <url> <sha> <dir>
    local url=$1 sha=$2 dir=$3
    if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null)" = "$sha" ]; then
        skip "$dir @ ${sha:0:7}"; return
    fi
    rm -rf "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
    git -C "$dir" fetch -q --depth 1 origin "$sha" \
        || die "$url çekilemedi (ağ yok mu? GitHub erişimi var mı?)"
    git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
    # --recursive ŞART: prjxray'in yaml-cpp/googletest/abseil'i submodule; eksikse cmake patlar.
    git -C "$dir" submodule update -q --init --recursive --depth 1
    ok "$dir @ ${sha:0:7} (+submodule)"
}

# ---------------------------------------------------------------- 0. ortam
step 0 "Ortam kontrolü"
[ "$(uname -s)" = Darwin ] || die "Bu script macOS için. Linux/Windows desteklenmiyor."
[ "$(uname -m)" = arm64 ]  || die "Sadece Apple Silicon (arm64) test edildi. Intel Mac henüz yok."
xcode-select -p >/dev/null 2>&1 || die "Xcode Command Line Tools yok. Önce:  xcode-select --install"
command -v brew >/dev/null   || die "Homebrew yok. Önce: https://brew.sh"
mkdir -p "$FPGA_HOME"
LOG="$FPGA_HOME/install.log"
exec > >(tee -a "$LOG") 2>&1
echo "    FPGA_HOME=$FPGA_HOME   JOBS=$JOBS   log: $LOG"
echo "    $(date)  $(sw_vers -productVersion)  $(uname -m)"

# ---------------------------------------------------------------- 1. brew
step 1 "Homebrew paketleri"
missing=()
for p in "${BREW_PKGS[@]}"; do
    brew list --formula "$p" >/dev/null 2>&1 && skip "$p" || missing+=("$p")
done
if [ ${#missing[@]} -gt 0 ]; then
    brew install "${missing[@]}"
    ok "${missing[*]}"
fi
BREW_PREFIX="$(brew --prefix)"
PY3="$BREW_PREFIX/opt/python@3.14/bin/python3.14"
[ -x "$PY3" ] || die "python@3.14 bulunamadı: $PY3"

# ---------------------------------------------------------------- 2. nextpnr-xilinx
# oss-cad-suite'te nextpnr-xilinx YOK (497 MB boşa gider). Kaynaktan derlenir.
step 2 "nextpnr-xilinx (kaynaktan derleme, ~2 dk)"
NEXTPNR_DIR="$FPGA_HOME/nextpnr-xilinx"
clone_pinned "$NEXTPNR_URL" "$NEXTPNR_SHA" "$NEXTPNR_DIR"
if [ -x "$NEXTPNR_DIR/build/nextpnr-xilinx" ] && [ -x "$NEXTPNR_DIR/build/bbasm" ]; then
    skip "nextpnr-xilinx binary"
else
    # USE_OPENMP=OFF ŞART: Apple clang -fopenmp bilmiyor, açık kalırsa cmake hata verir.
    cmake -S "$NEXTPNR_DIR" -B "$NEXTPNR_DIR/build" -G Ninja \
          -DARCH=xilinx -DCMAKE_BUILD_TYPE=Release \
          -DUSE_OPENMP=OFF -DBUILD_GUI=OFF -DBUILD_PYTHON=OFF -DBUILD_TESTS=OFF
    ninja -C "$NEXTPNR_DIR/build" -j"$JOBS" nextpnr-xilinx bbasm
    ok "nextpnr-xilinx + bbasm derlendi"
fi

# ---------------------------------------------------------------- 3. venv
# PEP 668: Homebrew Python'a pip install yasak -> venv şart.
step 3 "Python venv"
VENV="$FPGA_HOME/venv"
VPY="$VENV/bin/python"
[ -x "$VPY" ] || "$PY3" -m venv "$VENV"
if "$VPY" -c "import fasm, yaml, textx, simplejson, intervaltree" 2>/dev/null; then
    skip "fasm pyyaml textx simplejson intervaltree"
else
    "$VENV/bin/pip" install -q --upgrade pip
    "$VENV/bin/pip" install -q "${PIP_PKGS[@]}"
    ok "${PIP_PKGS[*]}"
fi

# ---------------------------------------------------------------- 4. prjxray
step 4 "prjxray (fasm2frames + xc7frames2bit, ~2 dk)"
PRJXRAY_DIR="$FPGA_HOME/prjxray"
clone_pinned "$PRJXRAY_URL" "$PRJXRAY_SHA" "$PRJXRAY_DIR"
if "$VPY" -c "import prjxray" 2>/dev/null; then
    skip "prjxray python paketi"
else
    "$VENV/bin/pip" install -q -e "$PRJXRAY_DIR"
    ok "prjxray python paketi (editable)"
fi
if [ -x "$PRJXRAY_DIR/build/tools/xc7frames2bit" ]; then
    skip "xc7frames2bit"
else
    # CMAKE_POLICY_VERSION_MINIMUM=3.5 ŞART: prjxray eski cmake sözdizimi kullanıyor,
    # cmake 4.x bunu olmadan reddediyor.
    cmake -S "$PRJXRAY_DIR" -B "$PRJXRAY_DIR/build" \
          -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
          -DPRJXRAY_BUILD_TESTING=OFF
    cmake --build "$PRJXRAY_DIR/build" --target xc7frames2bit -j"$JOBS"
    ok "xc7frames2bit derlendi"
fi

# ---------------------------------------------------------------- 5. chipdb
# nextpnr-xilinx hazır chipdb dağıtmıyor; her cihaz için elle üretilir.
step 5 "chipdb ($DEVICE, ~1 dk, ~900 MB RAM)"
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
    rm -f "$BBA"                         # 268 MB ara dosya; .bin yeter
    ok "$CHIPDB_BIN ($(du -h "$CHIPDB_BIN" | cut -f1))"
fi

# ---------------------------------------------------------------- 6. doğrula
step 6 "Doğrulama"
CLI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/mac-fpga"
BIN_DIR="$BREW_PREFIX/bin"                 # Apple Silicon brew: kullanıcı yazabilir, PATH'te
if [ "$(readlink -f "$(command -v mac-fpga 2>/dev/null || echo /nonexistent)")" = "$CLI" ]; then
    skip "mac-fpga PATH'te ($(command -v mac-fpga))"          # npm -g ya da önceki link
elif [ -w "$BIN_DIR" ]; then
    ln -sfn "$CLI" "$BIN_DIR/mac-fpga" && ok "mac-fpga -> $BIN_DIR/mac-fpga (PATH'te)"
else
    echo "    $BIN_DIR yazılamıyor; PATH'e ekle:  export PATH=\"$(dirname "$CLI"):\$PATH\""
fi
"$CLI" check
echo
echo "Toplam süre: $(( ($(date +%s) - T0) / 60 )) dk. Log: $LOG"
echo "Sıradaki:  mac-fpga new blink && cd blink && make flash"
