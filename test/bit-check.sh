#!/usr/bin/env bash
# test/bit-check.sh <top.bit> <top.fasm | top.frames>
# Reads the bitstream back and fails unless the frames it holds are the frames the .fasm describes.
# The .bit is parsed as UG470 ch. 5 lays it out: the header up to the sync word AA995566, then type 1 / type 2
# configuration packets; the FDRI writes are cut into 101-word frames (7-series, UG470 table 5-18) and given
# their addresses by walking part.yaml's columns the way xc7frames2bit does (block type, top/bottom, row,
# column, minor; two zero frames between rows and block types). The reference is fasm2frames.py on the .fasm
# (or the .frames file itself); frames it does not name are zero. Word 50's ECC field (13 bits, written by
# xc7frames2bit, absent from the .frames) is the one thing not compared.
# Exit 0 and one line when they match; exit 1 and an ERROR line naming the first frames that differ.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: test/bit-check.sh <top.bit> <top.fasm|top.frames>" >&2; exit 2; }
bit=$1; ref=$2
FPGA=${FPGA_HOME:-$HOME/fpga}
PART=xc7a35tcpg236-1
XRAYDB="$FPGA/nextpnr-xilinx/xilinx/external/prjxray-db/artix7"
PY="$FPGA/venv/bin/python"
F2F="$FPGA/prjxray/utils/fasm2frames.py"
[ -s "$bit" ] || { echo "ERROR [bit-check]: $bit is missing or empty" >&2; exit 1; }
[ -s "$ref" ] || { echo "ERROR [bit-check]: $ref is missing or empty" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
case $ref in
    *.frames) frames=$ref ;;
    *) frames="$T/ref.frames"
       PYTHONWARNINGS=ignore "$PY" "$F2F" --part $PART --db-root "$XRAYDB" "$ref" > "$frames" \
           || { echo "ERROR [bit-check]: fasm2frames could not read $ref" >&2; exit 1; } ;;
esac
"$PY" - "$bit" "$frames" "$XRAYDB/$PART/part.yaml" "$ref" <<'PY'
import struct, sys, yaml
bit, frames, part_yaml, ref = sys.argv[1:5]     # ref: the file named on the command line, for the messages
WPF = 101                       # words per frame, 7-series (UG470 table 5-18)
ECC_MASK = 0x1FFF               # word 50's ECC field, written by xc7frames2bit, not in the .frames

def fail(msg):
    print(f"ERROR [bit-check]: {bit} does not hold the frames of {ref}: {msg}", file=sys.stderr)
    sys.exit(1)

# --- the part's frame-address walk, as prjxray's Part::GetNextFrameAddress (part.yaml) ---
y = yaml.load(open(part_yaml), Loader=yaml.BaseLoader)
BUS = {"CLB_IO_CLK": 0, "BLOCK_RAM": 1, "CFG_CLB": 2}
walk = []                       # frame addresses in bitstream order
for btname, bt in sorted(BUS.items(), key=lambda kv: kv[1]):
    for half, region in (("top", 0), ("bottom", 1)):
        rows = y["global_clock_regions"].get(half, {}).get("rows", {})
        for row in sorted(rows, key=int):
            cols = rows[row]["configuration_buses"].get(btname, {}).get("configuration_columns", {})
            for col in sorted(cols, key=int):
                for minor in range(int(cols[col]["frame_count"])):
                    walk.append((bt << 23) | (region << 22) | (int(row) << 17) | (int(col) << 7) | minor)
def boundary(a, b):             # two zero frames follow a when the next frame is in another row/half/type
    return (a >> 17) != (b >> 17)

# --- read the bitstream back ---
raw = open(bit, "rb").read()
i = raw.find(b"\xaa\x99\x55\x66")
if i < 0:
    fail(f"no sync word AA995566 in {len(raw)} bytes (not a 7-series bitstream)")
body = raw[i + 4:]
n = len(body) // 4
w = struct.unpack(f">{n}I", body[:n * 4])
p = 0; reg = None; far = None; fdri = []; writes = 0
while p < n:
    h = w[p]; p += 1
    t = h >> 29
    if t == 1:
        op = (h >> 27) & 3; reg = (h >> 13) & 0x3FFF; cnt = h & 0x7FF
    elif t == 2:
        op = (h >> 27) & 3; cnt = h & 0x7FFFFFF
    else:
        continue                # NOP / padding
    if p + cnt > n:
        fail(f"truncated: a packet at word {p - 1} says {cnt} words, only {n - p} are left ({len(raw)} bytes in the file)")
    data = w[p:p + cnt]; p += cnt
    if op != 2:
        continue                # only writes matter
    if reg == 1 and cnt:        # FAR
        far = data[0]
    elif reg == 2 and cnt:      # FDRI
        if far is None:
            fail(f"an FDRI write at word {p - cnt - 1} with no FAR before it")
        fdri.append((far, data)); writes += 1
if not fdri:
    fail("no FDRI write: the bitstream configures no frame at all")

got = {}
for far, data in fdri:
    if len(data) % WPF:
        fail(f"FDRI data of {len(data)} words is not whole frames of {WPF}")
    try:
        k = walk.index(far)
    except ValueError:
        fail(f"FAR 0x{far:08x} is not a frame address of {part_yaml}")
    q = 0
    while q + WPF <= len(data):
        if k >= len(walk):
            if any(data[q:]): fail(f"{(len(data) - q) // WPF} frames past the last frame address of the part")
            break
        got[walk[k]] = data[q:q + WPF]; q += WPF
        if k + 1 < len(walk) and boundary(walk[k], walk[k + 1]):
            q += 2 * WPF        # the separator, two zero frames
        k += 1

# --- the reference ---
want = {}
for line in open(frames):
    a, _, ws = line.partition(" ")
    want[int(a, 16)] = tuple(int(x, 16) for x in ws.strip().split(","))
bad = []
for a in walk:
    g = got.get(a, (0,) * WPF); e = want.get(a, (0,) * WPF)
    if len(e) != WPF:
        fail(f"frame 0x{a:08x} in {ref} has {len(e)} words, not {WPF}")
    for j in range(WPF):
        gj, ej = g[j], e[j]
        if j == 50: gj &= ~ECC_MASK; ej &= ~ECC_MASK
        if gj != ej:
            bad.append(f"0x{a:08x} word {j}: bit 0x{g[j]:08x}, fasm 0x{e[j]:08x}"); break
missing = [a for a in want if a not in got and any(want[a])]
if missing:
    fail(f"{len(missing)} frames the fasm sets are not in the bitstream at all (first: 0x{missing[0]:08x}); the bitstream holds {len(got)} of the part's {len(walk)} frames")
if bad:
    fail(f"{len(bad)} of {len(walk)} frames differ, first {min(3, len(bad))}: " + "; ".join(bad[:3]))
set_ = sum(1 for a in want if any(want[a]))
print(f"bit ok: {bit} holds the {len(walk)} frames of {ref} ({set_} non-zero), read back from {writes} FDRI write(s)")
PY
