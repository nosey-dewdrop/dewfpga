#!/usr/bin/env python3
"""Compare the design's ports with the XDC; fail with a readable message BEFORE place-and-route.
Usage: check_xdc.py <top.json> <top.xdc>
       check_xdc.py --fix-ports <file.sv>...   (before synthesis: the course's SevenSegmentDisplay port line)"""
import json, re, sys

def fix_ports(files):
    """The course's SevenSegmentDisplay.sv declares `output [6:0] seg, logic dp,`: per the standard dp
    inherits `output` from the previous port. Vivado and Icarus accept that, Yosys does not (it reports
    "Module port `dp' is neither input nor output"). Every CS223 lab from lab 5 on carries this file, so the
    direction is written in for the student, and the changed line is printed. Nothing else is touched."""
    # an item that starts with a type (`logic dp`) or with a range (`[3:0] an`) and no direction of its own
    item = re.compile(r"(,\s*\n?\s*)((?:(?:logic|wire|reg|bit)\b\s*(?:\[[^\]]*\]\s*)?|\[[^\]]*\]\s*)[A-Za-z_]\w*)")
    for f in files:
        try: src = open(f, encoding="utf-8", errors="surrogateescape").read()
        except OSError: continue
        out, changed = [], []
        pos = 0
        for m in re.finditer(r"\bmodule\b[^;]*?\(([^;]*?)\)\s*;", src, re.S):   # each port list
            plist = m.group(1); new = plist
            def repl(mm):
                # the direction (and type) in force is the last input/output/inout before this position
                before = plist[:mm.start()]
                dirs = list(re.finditer(r"\b(input|output|inout)\b(\s*(logic|wire|reg|bit)\b)?", before))
                if not dirs: return mm.group(0)
                d = dirs[-1]; typ = (d.group(3) + " ") if d.group(3) and mm.group(2).startswith("[") else ""
                return mm.group(1) + d.group(1) + " " + typ + mm.group(2)
            new = item.sub(repl, plist)
            if new != plist:
                out.append(src[pos:m.start(1)]); out.append(new); pos = m.end(1)
                changed.append(plist)
        if changed:
            out.append(src[pos:]); text = "".join(out)
            open(f, "w", encoding="utf-8", errors="surrogateescape").write(text)
            for i, (a, b) in enumerate(zip(src.splitlines(), text.splitlines()), 1):
                if a != b: print(f"note: {f}:{i}: wrote the port direction in:  {b.strip()}   (Yosys needs it; Vivado accepts both)")
    return 0

def _strip_comments(src):
    """Comments blanked out but every newline kept, so offsets still map to line numbers."""
    def blank(m): return re.sub(r"[^\n]", " ", m.group(0))
    src = re.sub(r"/\*.*?\*/", blank, src, flags=re.S)
    return re.sub(r"//[^\n]*", blank, src)

def scan(files, want=None, xdc_names=(), prefer_tb=False):
    """Which file holds the top module, which files are testbenches. Printed as KEY=value lines for the shell.
    A testbench is a module with no ports, or one that calls $finish/$stop; the top is the design module that
    no other design module instantiates. File names are free: lab5.sv may hold `module top_design`."""
    mods = {}                       # name -> dict(file, tb, body, line)
    order = []
    for f in files:
        try: raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        src = _strip_comments(raw)
        for m in re.finditer(r"\bmodule\s+([A-Za-z_]\w*)(.*?)\bendmodule\b", src, re.S):
            name, body = m.group(1), m.group(2)
            head = body.split(";", 1)[0]
            ports = re.search(r"\)\s*$", head) and re.sub(r"#\s*\(.*?\)", "", head, flags=re.S)
            has_ports = bool(ports and re.search(r"\(\s*[^\s)]", ports))
            tb = (not has_ports) or bool(re.search(r"\$(finish|stop)\b", body))
            mods[name] = dict(file=f, tb=tb, body=body, line=src.count("\n", 0, m.start()) + 1, off=m.start())
            order.append(name)
    names = set(mods)
    inst = {}                       # module -> set of modules it instantiates
    problems = []
    for f in files:
        try: raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        head = raw[:2000]
        if ("\\<const0>" in raw or "\\<const1>" in raw or "(* keep_hierarchy" in raw
                or "NotValidForBitStream" in head or "write_verilog -mode funcsim" in head
                or "This verilog netlist is a functional simulation" in head):
            problems.append(f"{f} is a netlist Vivado wrote after synthesis, not source code (its header says so, and Yosys cannot read it). Delete it from this folder and keep your own .sv files; Vivado writes these under .sim/ and .runs/.")
    for n, d in mods.items():
        inst[n] = set()
        for other in names:
            if other == n: continue
            for m in re.finditer(r"(?<![\w.])" + re.escape(other) + r"\s*(#\s*\([^;]*?\))?\s*([A-Za-z_]\w*)?\s*\(", d["body"]):
                inst[n].add(other)
                if not m.group(2) and not d["tb"]:
                    line = d["line"] + d["body"].count("\n", 0, m.start())
                    problems.append(f"{d['file']}:{line}: `{other}(` is an instance without a name. Vivado lets that pass; the standard and Yosys do not. Write:  {other} u_{other}(")
    design = [n for n in order if not mods[n]["tb"]]
    used = set().union(*(inst[n] for n in design)) if design else set()
    roots = [n for n in design if n not in used]
    top = None
    if want:
        base = re.sub(r"\.(sv|v|SV|V)$", "", want)
        if want in mods and not mods[want]["tb"]: top = want
        else:
            infile = [n for n in design if re.sub(r"\.(sv|v|SV|V)$", "", mods[n]["file"]) == base]
            if len(infile) == 1: top = infile[0]
            elif want in mods: print(f"ERROR={want} is a testbench (it has no ports or calls $finish), not a design. Name the design module:  " + ", ".join(design)); return 1
            elif infile: top = next((n for n in infile if n in roots), infile[0])
            else: print(f"ERROR=no module named {want} in " + " ".join(files) + ". Modules here: " + ", ".join(design)); return 1
    elif len(roots) == 1: top = roots[0]
    elif not design: print("ERROR=no design module in " + " ".join(files) + (" (only testbenches)" if mods else "")); return 1
    else:
        pref = [n for n in roots if n in xdc_names] or [n for n in roots if re.sub(r"\.(sv|v|SV|V)$", "", mods[n]["file"]) == n]
        if prefer_tb and len(pref) != 1:      # for sim: the root that has a testbench
            pref = [n for n in roots if any(n in inst[t] for t in mods if mods[t]["tb"])]
        if len(pref) == 1: top = pref[0]
        else: print("ERROR=" + str(len(roots)) + " modules could be the top (nothing instantiates them): " + ", ".join(roots) + ". Name it:  dewfpga bit " + roots[0]); return 1
    for pr in problems: print("PROBLEM=" + pr)
    tbs = [n for n in order if mods[n]["tb"]]
    tb_for = [n for n in tbs if top in inst[n]] or ([tbs[0]] if len(tbs) == 1 else [])
    print("TOP=" + top)
    print("TOPFILE=" + mods[top]["file"])
    print("DESIGN=" + " ".join(dict.fromkeys(mods[n]["file"] for n in design)))
    print("TB=" + (mods[tb_for[0]]["file"] if tb_for else ""))
    print("AUTO=" + ("1" if not want else "0"))
    return 0

if len(sys.argv) >= 2 and sys.argv[1] == "--fix-ports":
    sys.exit(fix_ports(sys.argv[2:]))
if len(sys.argv) >= 2 and sys.argv[1] == "--scan":
    # --scan [--top NAME] [--xdc name,name] files...
    args = sys.argv[2:]; want = None; xn = (); ptb = False
    if args and args[0] == "--top": want = args[1]; args = args[2:]
    if args and args[0] == "--xdc": xn = tuple(args[1].split(",")); args = args[2:]
    if args and args[0] == "--prefer-tb": ptb = True; args = args[1:]
    sys.exit(scan(args, want, xn, ptb))
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
