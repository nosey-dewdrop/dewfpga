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

# 2) ports mentioned in the XDC, and which properties each one got
xdc_ports = set()
has_pin, has_iostd = set(), set()
for line in open(xf, encoding="utf-8", errors="replace"):
    line = line.split("#")[0]
    for m in re.finditer(r"get_ports\s*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", line):
        xdc_ports.add(m.group(1))
        if re.search(r"\bPACKAGE_PIN\b", line): has_pin.add(m.group(1))
        if re.search(r"\bIOSTANDARD\b", line): has_iostd.add(m.group(1))

missing = sorted(ports - xdc_ports)   # in the code, not in the XDC
extra   = sorted(xdc_ports - ports)   # in the XDC, not in the code

xdc_base = {q.split("[")[0] for q in xdc_ports}
if missing:
    # two different mistakes: the name exists in the XDC but not for these indices (the lines are still
    # commented out), or the name is not in the XDC at all (the module uses a different name)
    commented = [p for p in missing if p.split("[")[0] in xdc_base]
    renamed   = [p for p in missing if p.split("[")[0] not in xdc_base]
    print(f"ERROR: these ports have NO pin in the XDC ({tname}):")
    if commented:
        for p in commented: print(f"   - {p}")
        print("   -> the XDC has lines for these pins, still commented out. Remove the # at the start of")
        print("      each of those lines (the same name, the index the design uses).")
    if renamed:
        xdc_lower = {q.lower(): q for q in xdc_ports}
        for p in renamed:
            near = xdc_lower.get(p.lower())
            print(f"   - {p}" + (f"      (the XDC has '{near}': same name, different case)" if near else ""))
        print("   -> the port names in the module must match the names in the XDC (the course file uses")
        print("      clk, sw, led, btnC btnU btnL btnR btnD, seg, dp, an). Rename the port in the module,")
        print("      or change the name inside [get_ports ...] on that line of the XDC.")
        print("      A line that still starts with # is commented out and does not count.")
    sys.exit(1)
no_iostd = sorted(p for p in ports if p in has_pin and p not in has_iostd)
if no_iostd:
    print(f"ERROR: these ports have a PACKAGE_PIN but no IOSTANDARD in the XDC ({tname}):")
    for p in no_iostd: print(f"   - {p}")
    print("   -> every pin needs both lines; add for each one:")
    print(f"      set_property IOSTANDARD LVCMOS33 [get_ports {{{no_iostd[0]}}}]")
    sys.exit(1)
# pins in the XDC that the design does not use are fine (nextpnr ignores them); a whole
# uncommented Basys3_Master.xdc is the normal lab setup, and led[15] with a led[1:0] port is just
# an unused pin. Only a case difference (LED vs led) looks like a typo, so only that gets a warning.
base = {q.split("[")[0] for q in ports}
typos = [p for p in extra if p.split("[")[0] not in base and p.split("[")[0].lower() in {b.lower() for b in base}]
for p in typos:
    print(f"warning: the XDC names '{p}' but the design's port is spelled differently (case differs)")
print(f"xdc ok: {len(ports)} ports, all mapped" + (f", {len(extra)} unused pins in the XDC ignored." if extra else "."))
