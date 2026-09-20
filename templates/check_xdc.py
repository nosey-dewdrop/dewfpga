#!/usr/bin/env python3
"""Compare the design's ports with the XDC; fail with a readable message BEFORE place-and-route.
Usage: check_xdc.py <top.json> <top.xdc>"""
import json, re, sys

if len(sys.argv) != 3:
    sys.exit("usage: check_xdc.py <json> <xdc>")

jf, xf = sys.argv[1], sys.argv[2]

# 1) ports in the design (from yosys json)
design = json.load(open(jf))
top = None
for name, mod in design["modules"].items():
    if mod.get("attributes", {}).get("top"):
        top = (name, mod); break
if top is None:
    name = list(design["modules"])[0]; top = (name, design["modules"][name])
tname, tmod = top

ports = set()
for p, info in tmod.get("ports", {}).items():
    n = len(info.get("bits", []))
    if n == 1: ports.add(p)
    else: ports.update(f"{p}[{i}]" for i in range(n))

# 2) ports mentioned in the XDC
xdc_ports = set()
for line in open(xf):
    line = line.split("#")[0]
    for m in re.finditer(r"get_ports\s*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", line):
        xdc_ports.add(m.group(1))

missing = sorted(ports - xdc_ports)   # in the code, not in the XDC
extra   = sorted(xdc_ports - ports)   # in the XDC, not in the code

if missing:
    print(f"ERROR: these ports have NO pin in the XDC ({tname}):")
    for p in missing: print(f"   - {p}")
    print("   -> copy the matching lines from Basys3_Master.xdc.")
if missing:
    sys.exit(1)
# pins in the XDC that the design does not use are fine (nextpnr ignores them); a whole
# uncommented Basys3_Master.xdc is the normal lab setup. Only a near-miss looks like a typo.
typos = [p for p in extra if any(p.split("[")[0].lower() == q.split("[")[0].lower() and p != q for q in ports)]
for p in typos:
    print(f"warning: the XDC names '{p}' but the design has no such port (case or index differs from a real port)")
print(f"xdc ok: {len(ports)} ports, all mapped" + (f", {len(extra)} unused pins in the XDC ignored." if extra else "."))
