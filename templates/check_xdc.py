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
    xdc_lower = {q.lower(): q for q in xdc_ports}
    for p in missing:
        near = xdc_lower.get(p.lower())
        print(f"   - {p}" + (f"      (the XDC has '{near}': same name, different case)" if near else ""))
    print("   -> the port names in the module must match the names in the XDC (the course file uses")
    print("      clk, sw, led, btnC btnU btnL btnR btnD, seg, dp, an). Rename the port in the module,")
    print("      or change the name inside [get_ports ...] on that line of the XDC.")
    print("      A line that still starts with # is commented out and does not count.")
    sys.exit(1)
# pins in the XDC that the design does not use are fine (nextpnr ignores them); a whole
# uncommented Basys3_Master.xdc is the normal lab setup, and led[15] with a led[1:0] port is just
# an unused pin. Only a case difference (LED vs led) looks like a typo, so only that gets a warning.
base = {q.split("[")[0] for q in ports}
typos = [p for p in extra if p.split("[")[0] not in base and p.split("[")[0].lower() in {b.lower() for b in base}]
for p in typos:
    print(f"warning: the XDC names '{p}' but the design's port is spelled differently (case differs)")
print(f"xdc ok: {len(ports)} ports, all mapped" + (f", {len(extra)} unused pins in the XDC ignored." if extra else "."))
