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

def _synth_view(src):
    """The text as the synthesis preprocessor hands it on: yosys' read_verilog defines SYNTHESIS, as Vivado does
    (UG901), so the body of `ifndef SYNTHESIS and the `else part of `ifdef SYNTHESIS are dropped (blanked here,
    newlines kept). Every other `ifdef is kept whole: what those macros are is not known here."""
    out, pos, stack = [], 0, []          # stack: [this branch kept, an earlier SYNTHESIS branch was taken]
    def blank(t): return re.sub(r"[^\n]", " ", t)
    for m in re.finditer(r"^[ \t]*`(ifdef|ifndef|elsif|else|endif)\b[ \t]*([A-Za-z_]\w*)?", src, re.M):
        dropped = any(not b[0] for b in stack)
        out.append(blank(src[pos:m.start()]) if dropped else src[pos:m.start()]); pos = m.start()
        d, name = m.group(1), m.group(2)
        if d in ("ifdef", "ifndef"):
            kept = (d == "ifdef") if name == "SYNTHESIS" else True
            stack.append([kept, kept and name == "SYNTHESIS"])
        elif stack and d == "elsif":
            kept = not stack[-1][1]        # after a SYNTHESIS branch was taken, nothing else in the chain is
            stack[-1] = [kept, stack[-1][1] or (kept and name == "SYNTHESIS")]
        elif stack and d == "else": stack[-1][0] = not stack[-1][1]
        elif stack: stack.pop()
    dropped = any(not b[0] for b in stack)
    out.append(blank(src[pos:]) if dropped else src[pos:])
    return "".join(out)

def _typedefs(src):
    """Every typedef as (start, end, name): `typedef logic [7:0] byte_t;` names the word before its `;`, and a
    struct/union/enum body (`typedef struct packed { logic [3:0] hi; ... } pair_t;`) holds `;` of its own, so
    there the name is the word after the closing brace."""
    found = []
    for m in re.finditer(r"\btypedef\b", src):
        i, depth, start = m.end(), 0, m.start()
        while i < len(src):
            c = src[i]
            if c == "{": depth += 1
            elif c == "}": depth -= 1
            elif c == ";" and depth <= 0: break
            i += 1
        nm = re.search(r"([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*$", src[m.end():i])
        if nm: found.append((start, i + 1, nm.group(1)))
    return found

def _blank_typedefs(text):
    for a, b, _ in _typedefs(text): text = text[:a] + re.sub(r"[^\n]", " ", text[a:b]) + text[b:]
    return text

_VAR_TYPES = r"logic|reg|bit|byte|shortint|int|integer|longint|time"
_KW = set("input output inout logic reg wire bit byte shortint int integer longint time signed unsigned var tri tri0 tri1 "
          "wand wor supply0 supply1 const static automatic parameter localparam genvar".split())

def _split_commas(s):
    """Split on the commas outside (), [] and {}."""
    out, depth, start = [], 0, 0
    for i, c in enumerate(s):
        if c in "([{": depth += 1
        elif c in ")]}": depth -= 1
        elif c == "," and depth == 0: out.append(s[start:i]); start = i + 1
    out.append(s[start:])
    return out

def _decl_names(text, types):
    """The names declared by every `<type> [range] a = .., b;` statement in text (ports or body)."""
    names = set()
    for m in re.finditer(r"\b(?:" + types + r")\b([^;]*?)(?:;|$)", text, re.S):
        for piece in _split_commas(re.sub(r"\[[^\]]*\]", " ", m.group(1))):
            piece = piece.split("=", 1)[0]
            ids = [i for i in re.findall(r"[A-Za-z_]\w*", piece) if i not in _KW]
            if ids: names.add(ids[-1])
    return names

def _decl_init_problems(f, body, bline, typedefs):
    """A variable declared with an initializer that reads a signal (`logic [3:0] sum = sw[3:0] + sw[7:4];`,
    meant as an adder): per IEEE 1800-2017 6.8 the expression is evaluated once, as the start value, so the
    simulation sets sum at time 0 and yosys makes it the power-up value; the board never follows sw.
    Ports and every net/variable the module declares are the signals; parameters, enum names and package
    constants are not, so a constant start value (`logic [3:0] cnt = 4'd5;`) passes."""
    head, sep, rest = body.partition(";")
    ports = _decl_names(re.sub(r"#\s*\(.*?\)", "", head, flags=re.S), "input|output|inout")
    # function/task bodies are their own scope; a for-loop's `int i = 0` is not a declaration statement
    blank = lambda m: re.sub(r"[^\n]", " ", m.group(0))
    scope = re.sub(r"\bfunction\b.*?\bendfunction\b|\btask\b.*?\bendtask\b", blank, rest, flags=re.S)
    # `parameter int STEP = 1;` / `localparam integer LIMIT = 9;` declare constants, not signals: the int/integer
    # in them is the constant's type. The statement is blanked out, so its name never counts as a signal read.
    scope = re.sub(r"\b(?:parameter|localparam|genvar)\b[^;]*;", blank, _blank_typedefs(scope))
    signals = ports | _decl_names(scope, "input|output|inout|" + _VAR_TYPES + r"|wire|tri|tri0|tri1|wand|wor")
    types = _VAR_TYPES + ("|" + "|".join(map(re.escape, typedefs)) if typedefs else "")
    problems = []
    for m in re.finditer(r"(?m)^[ \t]*(?:" + types + r")\b((?:\s*(?:signed|unsigned))?(?:\s*\[[^\]]*\])*)([^;]*);", scope):
        for piece in _split_commas(m.group(2)):
            if "=" not in piece: continue
            name, expr = (s.strip() for s in piece.split("=", 1))
            name = re.sub(r"\[.*", "", name).strip()
            if not re.fullmatch(r"[A-Za-z_]\w*", name): continue     # not a declaration (`hi = sw[7:4];` in an always block)
            e = re.sub(r"\d*'[sS]?[bBdDhHoO]\s*[0-9a-fA-FxXzZ_?]+|'[01xXzZ]|\$\w+|\w+::\w+", " ", expr)
            reads = [i for i in dict.fromkeys(re.findall(r"[A-Za-z_]\w*", e)) if i in signals and i != name]
            if not reads: continue
            line = bline + rest.count("\n", 0, m.start(2))
            # a register (an always block writes it too) is loaded where it is written, not turned into a wire
            others = scope[:m.start()] + scope[m.end():]
            is_reg = re.search(r"(?<![\w.])" + re.escape(name) + r"\s*(?:\[[^\]]*\]\s*)*<?=(?!=)", others)
            fix = (f"declare {name} without the = part and load it in the always block that writes it, under its reset:  if (reset) {name} <= {expr};"
                   if is_reg else f"assign {name} = {expr};   and declare {name} without the = part")
            problems.append(f"{f}:{line}: `{name} = {expr}` in a declaration is a start value, not a wire: it reads {', '.join(reads)} once, "
                            f"at time 0 (IEEE 1800-2017 6.8; yosys makes it the power-up value, so the board never follows {reads[0]}). "
                            f"Write:  {fix}")
    return problems

def scan(files, want=None, xdc_names=()):
    """Which file holds the top module, which files are testbenches. Printed as KEY=value lines for the shell.
    A testbench is a module with no ports (or an empty port list); a module with ports is a design, even
    when it calls $finish (that is a PROBLEM: Vivado ignores $finish, UG901 Table 21, and yosys stops on it).
    The top is the design module that no other design module instantiates. File names are free: lab5.sv may
    hold `module top_design`. When two modules could be the top and nothing names one, the scanner stops and
    names both, unless exactly one is named like a .xdc in the folder: then WHY= says so, and the CLI prints it."""
    mods = {}                       # name -> dict(file, tb, body, line)
    order = []
    problems = []
    for f in files:
        try: raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        src = _strip_comments(raw)
        typedefs = [n for _, _, n in _typedefs(src)]
        synth = _synth_view(src)        # same length as src: a module's span is the same in both
        for m in re.finditer(r"\bmodule\s+([A-Za-z_]\w*)(.*?)\bendmodule\b", src, re.S):
            name, body = m.group(1), m.group(2)
            line = src.count("\n", 0, m.start()) + 1
            if name in mods:            # a backup next to the file (lab4_old.sv): the last one read would win silently
                d = mods[name]
                (f1, l1), (f2, l2) = sorted([(d['file'], d['line']), (f, line)])     # the same order on every machine
                problems.append(f"module {name} is defined twice: {f1}:{l1} and {f2}:{l2}. Keep one, or move the backup out of this folder")
                continue
            head = body.split(";", 1)[0]
            ports = re.search(r"\)\s*$", head) and re.sub(r"#\s*\(.*?\)", "", head, flags=re.S)
            has_ports = bool(ports and re.search(r"\(\s*[^\s)]", ports))
            bline = src.count("\n", 0, m.start(2)) + 1
            mods[name] = dict(file=f, tb=not has_ports, body=body, line=line, off=m.start())
            order.append(name)
            if has_ports:
                # what synthesis sees: a check under `ifndef SYNTHESIS is simulation-only and is fine
                sbody = synth[m.start(2):m.end(2)]
                for fm in re.finditer(r"\$(finish|stop)\b", sbody):
                    fl = bline + sbody.count("\n", 0, fm.start())
                    problems.append(f"{f}:{fl}: ${fm.group(1)} in a design module ({name}). Vivado ignores it (UG901 Table 21: $finish Ignored) and yosys stops on it; remove it, move the check to the testbench, or wrap it in `ifndef SYNTHESIS ... `endif")
                problems += _decl_init_problems(f, sbody, bline, typedefs)
    names = set(mods)
    inst = {}                       # module -> set of modules it instantiates
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
            # `inv u_inv (`, `inv #(.N(4)) u_inv (`, and an instance array `inv u_inv [3:0] (`
            for m in re.finditer(r"(?<![\w.])" + re.escape(other) + r"\s*(#\s*\([^;]*?\))?\s*([A-Za-z_]\w*)?\s*(\[[^\]]*\]\s*)?\(", d["body"]):
                inst[n].add(other)
                if not m.group(2) and not d["tb"]:
                    line = d["line"] + d["body"].count("\n", 0, m.start())
                    problems.append(f"{d['file']}:{line}: `{other}(` is an instance without a name. Vivado lets that pass; the standard and Yosys do not. Write:  {other} u_{other}(")
    for pr in problems: print("PROBLEM=" + pr)
    if problems: return 1
    design = [n for n in order if not mods[n]["tb"]]
    used = set().union(*(inst[n] for n in design)) if design else set()
    roots = [n for n in design if n not in used]
    top = None; why = ""
    if want:
        base = re.sub(r"\.(sv|v|SV|V)$", "", want)
        if want in mods and not mods[want]["tb"]: top = want
        else:
            infile = [n for n in design if re.sub(r"\.(sv|v|SV|V)$", "", mods[n]["file"]) == base]
            if len(infile) == 1: top = infile[0]
            elif want in mods: print(f"ERROR={want} is a testbench (it has no ports), not a design. Name the design module:  " + ", ".join(design)); return 1
            elif infile:
                inroots = [n for n in infile if n in roots]
                if len(inroots) == 1: top = inroots[0]
                else: print(f"ERROR={len(infile)} modules in {want} could be the top: " + ", ".join(infile) + ". Name the module:  dewfpga bit " + infile[0]); return 1
            else: print(f"ERROR=no module named {want} in " + " ".join(files) + ". Modules here: " + ", ".join(design)); return 1
    elif len(roots) == 1: top = roots[0]
    elif not design: print("ERROR=no design module in " + " ".join(files) + (" (only testbenches)" if mods else "")); return 1
    else:
        # never by file name: the file is named after one module and the project's top is the other (corpus
        # Lab 4 folders). A .xdc named after one root is a choice the student made, and the CLI says it took it
        pref = [n for n in roots if n in xdc_names]
        if len(pref) == 1: top = pref[0]; why = "named by " + top + ".xdc"
        else: print("ERROR=" + str(len(roots)) + " modules could be the top (nothing instantiates them): " + ", ".join(roots) + ". Name it:  dewfpga bit " + roots[0]); return 1
    tbs = [n for n in order if mods[n]["tb"]]
    tb_for = [n for n in tbs if top in inst[n]] or ([tbs[0]] if len(tbs) == 1 else [])
    print("TOP=" + top)
    print("WHY=" + why)
    print("TOPFILE=" + mods[top]["file"])
    print("DESIGN=" + " ".join(dict.fromkeys(mods[n]["file"] for n in design)))
    print("TB=" + (mods[tb_for[0]]["file"] if tb_for else ""))
    print("AUTO=" + ("1" if not want else "0"))
    return 0

if len(sys.argv) >= 2 and sys.argv[1] == "--fix-ports":
    sys.exit(fix_ports(sys.argv[2:]))
if len(sys.argv) >= 2 and sys.argv[1] == "--scan":
    # --scan [--top NAME] [--xdc name,name] files...
    args = sys.argv[2:]; want = None; xn = ()
    if args and args[0] == "--top": want = args[1]; args = args[2:]
    if args and args[0] == "--xdc": xn = tuple(args[1].split(",")); args = args[2:]
    sys.exit(scan(args, want, xn))
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
