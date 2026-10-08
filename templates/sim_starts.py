#!/usr/bin/env python3
"""dewfpga sim: start every register and memory of the design that has no start value where the board starts it.

iverilog starts every variable at x, as IEEE 1800 says. A register with a synchronous reset and no start value stays
x until the first clock edge with the reset high; at the first edge without it, case (x) takes the default item,
if (x == S) takes the else branch, x + 1 stays x, so the simulation shows a definite value that the board
contradicts: on the board every flip-flop starts at a known value, and since #34 the netlist dewfpga bit writes
does too. Measured on probe 105's netlist and FASM: a register with a reset starts at its reset value bit by bit
(yosys maps a reset-to-1 bit to FDSE or FDPE and nextpnr programs INIT 1; a 0 bit to FDRE or FDCE at 0), a register
with no reset at 0, a LUT RAM word at 0, a declared start value as declared.

Usage: sim_starts.py [--plain] <regs.json> <tb file> <top> <source files...>
  --plain: the simulation compiles the elaborated design the build wrote back as Verilog (the sim-from-build
  path, <top>_sim.elab), where an enum is a plain reg: every variable is written whole (no enum item or cast).
  regs.json: the design read by yosys up to  proc; flatten; memory_collect; opt_dff; write_json  (the Makefile
  runs it). The script writes <top>_start.sv: module dewfpga_start with one initial block that, at #0 (after the
  design's own declaration values and the testbench's time-0 statements ran), sets every register bit that is
  still x or z to the board's value, and every word of a memory that has no value at all to 0, through the testbench's
  instance path <tb module>.<instance>.<path>. A memory with some words loaded and others not ($readmemh with a start
  and an end address, a file shorter than the table) is not started: yosys folds its unloaded words as don't-care
  and the netlist reads some value there (measured: CC where the simulation showed x), so a 0 would claim a board
  value the build does not keep; the words stay x and the note says so. It prints one line for the product's note
  (what was started, how) on stdout.
  When nothing needs a start (every register has a declared value, as blink's do), or the testbench does not
  instantiate <top>, or anything in the listing is not understood, it writes no file and prints nothing: the
  simulation runs exactly as it did before.

How a value is written, tested in iverilog 13: a vector, a packed struct, a packed array of any dimensions and a
memory word are written whole through a concat lvalue ('t = {path}; patch the x bits of t; {path} = t[w-1:0];', or
'{path[k]} = ...' for a memory word); an enum of 2 or more bits by bit selects (iverilog refuses a whole write, a
force and a concat lvalue on an enum: 'This assignment requires an explicit cast'); a 1-bit enum through its items
(first()/last()); type(path)'(v) casts are not parsed by iverilog. Which variables are enums: yosys' own reader
marks them with enum_value_* attributes, yosys-slang's RTLIL carries none, so they are also found in the source
text: 'typedef enum ... } NAME;' and every declaration 'NAME var [= init][, var [= init]]*;' plus an anonymous
'enum ... {...} var;'. The listing and the reset-value rule are those of test/sv/eqv.py's rtl_starts, which
starts the probe runner's RTL copy the same way; this copy keeps the product free of the test harness."""
import json, os, re, sys

# flip-flops that start at 1 when their INIT is x. nextpnr-xilinx (xilinx/fasm.cc, commit 3fd7878):
# `int def_init = (type == "FDSE" || type == "FDSE_1" || type == "FDPE" || type == "FDPE_1") ? 1 : 0;`,
# so FDRE, FDCE and both latches, LDCE and LDPE, start at 0. yosys maps a reset-to-1 bit to FDSE/FDPE.


def assigned_in(src):
    """The names written (name <= or name =) in the source text a yosys src attribute points to
    ("design.sv:12.3-15.6", line.column, several joined by |): the always block that made a register, cut at
    its columns, so an assign on the same line (assign w = q; always_ff ... q <= d;) is not part of it."""
    names = set()
    for loc in (src or "").split("|"):
        m = re.match(r"(.+):(\d+)\.(\d+)-(\d+)\.(\d+)$", loc)
        if not m: continue
        try: lines = open(m.group(1), encoding="utf-8", errors="replace").read().splitlines()
        except OSError: continue
        l1, c1, l2, c2 = (int(g) for g in m.group(2, 3, 4, 5))
        part = lines[l1 - 1:l2]
        if not part: continue
        part[-1] = part[-1][:c2]; part[0] = part[0][c1 - 1:]      # the end first: both may cut one line
        text = re.sub(r"//[^\n]*", "", "\n".join(part))
        names |= set(re.findall(r"(?<![\w.$])([A-Za-z_]\w*)\s*(?:\[[^\]]*\]\s*)*(?:<=|=)(?!=)", text))
    return names


def rtl_starts(path, top, assigned=frozenset()):
    """The design's registers, from the design read by yosys up to proc (flatten; memory_collect; opt_dff), as
    ("var", path, width, kind, bits, reset, init) and ("mem", name, first, words, width, init). path is the name
    iverilog knows under the design instance (u_fsm.state for a submodule's register); bits holds (i, index, value)
    for each register bit of it: i its place in the whole variable (0 = the right-most bit), index its bit select,
    value the board's start for that bit: 1 where a synchronous or asynchronous reset sets the bit to 1 (yosys
    maps it to FDSE or FDPE), else 0 (FDRE, FDCE, a latch, a LUT RAM). reset says whether the register has a
    reset at all; init is the variable's declared start value (yosys' init attribute, a string of 0/1/x per bit,
    "" when none): a bit the declaration sets is never x, so it is not started and not counted. kind says how
    iverilog lets the start module write it: "enum" (a variable of one enum type takes no vector without a cast,
    but a bit select), "enum1" (a 1-bit enum takes neither, only one of its items), "vec" (anything else, written
    whole, since a bit select of a packed array of enums or of logic [1:0][3:0] picks an element, not a bit). A bit
    that several names share (assign w = q;, wire [3:0] low = led[3:0]) gets the name its always block writes.
    The names looked at first are those of the module the always block is in (a register n of top that feeds a
    submodule's input port D is also called A1.D after flatten, a net, and so is a top wire q that a submodule's
    register q drives): each instance's module source comes from yosys' $scopeinfo cells, top's from its own src."""
    mods = json.load(open(path))["modules"]
    mod = mods.get(top) or next(m for m in mods.values() if str(m.get("attributes", {}).get("top", "0")).strip("0 "))
    # the source lines of each instance's module, by instance path ("" is top): "design.sv:5.1-9.10"
    scopes = {"": mod.get("attributes", {}).get("src", "")}
    for cn, c in mod["cells"].items():
        if c["type"] == "$scopeinfo":
            a = c.get("attributes", {})
            scopes[a["hdlname"].replace(" ", ".") if a.get("hdlname") else cn] = a.get("module_src", "")
    def lines(src):
        m = re.match(r"(.+):(\d+)\.\d+-(\d+)\.\d+$", (src or "").split("|")[0])
        return (m.group(1), int(m.group(2)), int(m.group(3))) if m else None
    def declared_around(p, at):
        """whether the module a name (u_mid.u_leaf.q) is declared in, its longest instance prefix, holds line at"""
        parts = p.split(".")[:-1]
        while parts and ".".join(parts) not in scopes: parts.pop()
        m = lines(scopes[".".join(parts)])
        return bool(m and at and m[0] == at[0] and m[1] <= at[1] <= m[2])
    names, ports, info = {}, set(mod.get("ports", {})), {}
    for n, w in mod["netnames"].items():
        if w.get("hide_name") or "$" in n or "\\" in n: continue
        attrs = w.get("attributes", {})
        hdl = attrs.get("hdlname")
        p = hdl.replace(" ", ".") if hdl else n
        bits, off, upto = w["bits"], w.get("offset", 0), w.get("upto", 0)
        # yosys marks an enum variable with enum_value_<bits> = \ITEM, the key as wide as one enum value
        items = {k[len("enum_value_"):]: str(v).lstrip("\\") for k, v in attrs.items() if k.startswith("enum_value_")}
        kind = "vec" if not items or len(next(iter(items))) != len(bits) else "enum1" if len(bits) == 1 else "enum"
        init = str(attrs.get("init", ""))
        init = init if init and not set(init) - set("01xz") else ""
        info[p] = (len(bits), kind, init, bits, off, upto)
        for i, b in enumerate(bits):
            if isinstance(b, int):
                idx = None if len(bits) == 1 else (off + len(bits) - 1 - i if upto else off + i)
                names.setdefault(b, []).append((n in ports, p, idx, i))
    out, seen, regs, resets = [], set(), {}, {}
    for c in mod["cells"].values():
        t, prm = c["type"], c.get("parameters", {})
        if t == "$mem_v2":
            name = prm["MEMID"].lstrip("\\")
            if "$" in name: continue
            size, off, width = int(prm["SIZE"], 2), int(prm["OFFSET"], 2), int(prm["WIDTH"], 2)
            init = str(prm.get("INIT", ""))
            out.append(("mem", name, off, size, width, init if init and not set(init) - set("01xz") else ""))
            continue
        if not re.match(r"\$(a|s|al)?(dff|dlatch|sr)", t) or "Q" not in c["connections"]: continue
        # a flip-flop's reset value decides FDSE/FDPE (1) or FDRE/FDCE (0); a latch starts at 0 either way
        rv = "" if "latch" in t else prm.get("SRST_VALUE") or prm.get("ARST_VALUE") or ""
        has_reset = "latch" not in t and ("SRST_VALUE" in prm or "ARST_VALUE" in prm)
        written, at_src = None, lines(c.get("attributes", {}).get("src"))
        for i, b in enumerate(c["connections"]["Q"]):
            if not isinstance(b, int) or b in seen or b not in names: continue
            seen.add(b)
            cands = sorted(names[b])
            # the names of the module the always block is in, then the design's own variable, not an output port
            # or a wire it drives (led <= ..., assign w = q;)
            cands = [x for x in cands if declared_around(x[1], at_src)] or cands
            # more than one name left (the register, a wire that names it or a slice of it, an output port):
            # the name its always block writes, even when a wire's name sorts first (wire [3:0] low = led[3:0])
            if len(cands) > 1:
                if written is None: written = assigned_in(c.get("attributes", {}).get("src"))
                cands = [x for x in cands if x[1].split(".")[-1] in written] or cands
            # a name the source drives with a continuous assignment (assign s4 = state2;) is the register's alias,
            # not the register: iverilog refuses to write it ("cannot be driven by a continuous assignment"), and
            # one such line drops the whole start module (fuzz seed 134: nothing started, the netlist differed at
            # cycle 0). The name an always block writes is taken; when every name is such an alias, the bit is
            # not started.
            cands = [x for x in cands if x[1].split(".")[-1] not in assigned] or []
            if not cands: continue
            port, p, idx, at = cands[0]
            v = rv[-1 - i] if i < len(rv) and rv[-1 - i] in "01" else "0"
            regs.setdefault(p, []).append((at, idx, v))
            resets[p] = resets.get(p, False) or has_reset
    # a bit of a register that opt_dff folded to a constant (written one constant under reset, held otherwise:
    # m2[1] <= 2 under the reset, nothing else) is no $dff cell any more; the netlist and the board hardwire it
    # to that constant, the simulation keeps it x until the first reset, so it is started at the constant too
    for p, bits in regs.items():
        w, off, upto = info[p][3], info[p][4], info[p][5]
        have = {b[0] for b in bits}
        for i, b in enumerate(w):
            if b in ("0", "1") and i not in have:
                idx = None if len(w) == 1 else (off + len(w) - 1 - i if upto else off + i)
                bits.append((i, idx, b))
        bits.sort()
    return out + [("var", p, *info[p][:2], bits, resets[p], info[p][2]) for p, bits in regs.items()]


def enum_vars_in(files):
    """the names of the variables declared with an enum type in the source files, by name -> (type name, first item)"""
    text = ""
    for f in files:
        try: text += "\n" + re.sub(r"//[^\n]*", "", open(f, encoding="utf-8", errors="replace").read())
        except OSError: pass
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    types = {}
    for m in re.finditer(r"typedef\s+enum\b[^{]*\{\s*([A-Za-z_]\w*)[^}]*\}\s*(\w+)\s*;", text):
        types[m.group(2)] = m.group(1)
    found = {}
    for m in re.finditer(r"(?<![\w.])(\w+)\s+([A-Za-z_]\w*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[A-Za-z_]\w*(?:\s*=\s*[^,;]+)?)*)\s*;", text):
        if m.group(1) in types:
            for v in re.split(r"\s*,\s*", m.group(2)): found[v.split("=")[0].strip()] = (m.group(1), types[m.group(1)])
    for m in re.finditer(r"\benum\b[^{;]*\{\s*([A-Za-z_]\w*)[^}]*\}\s*(\w+(?:\s*,\s*\w+)*)\s*;", text):   # anonymous enum
        for v in re.split(r"\s*,\s*", m.group(2)): found[v.strip()] = ("", m.group(1))
    return found


def main(regs_json, tbfile, top, srcs, plain=False):
    """plain: the design iverilog compiles is the elaborated one the build wrote back as Verilog ($(TOP)_sim.elab,
    the sim-from-build path), where every enum is a plain reg: every variable is written whole, as a vector."""
    tb = open(tbfile, encoding="utf-8", errors="replace").read()
    tb = re.sub(r"//[^\n]*", "", tb)
    mm = re.search(r"^\s*module\s+([A-Za-z_]\w*)", tb, re.M)
    mi = re.search(r"(?<![\w.])%s\s*(?:#\s*\((?:[^()]|\([^()]*\))*\)\s*)?([A-Za-z_]\w*)\s*\(" % re.escape(top), tb)
    if not mm or not mi: return None
    base = f"{mm.group(1)}.{mi.group(1)}"
    enums = {} if plain else enum_vars_in(srcs)
    starts, partial = [], []
    assigned = set()
    for f in srcs:
        try: text = re.sub(r"//[^\n]*", "", open(f, encoding="utf-8", errors="replace").read())
        except OSError: continue
        assigned |= set(re.findall(r"(?<![\w.$])assign\s+([A-Za-z_]\w*)", text))
    for r in rtl_starts(regs_json, top, assigned):
        if r[0] == "mem":
            _, name, off, size, width, init = r
            if init and set(init) & set("01"):
                # some words declared ($readmemh("rom.hex", rom, 0, 3) on a 16-word table): the words it left x
                # are not started. yosys folds the table with them as don't-care, so the netlist reads some
                # value there (measured: CC where the simulation showed x), not 0: starting them at 0 would
                # claim a board value the build does not keep. They stay x, and the note says so.
                if set(init) - set("01"): partial.append(r)
                continue
            starts.append(r)                                           # no value at all: a LUT RAM word at 0
            continue
        _, p, width, kind, bits, reset, init = r
        # the bits the declaration sets are never x: only the others are started and counted
        if init: bits = [b for b in bits if not (b[0] < len(init) and init[-1 - b[0]] in "01")]
        if not bits: continue
        leaf = p.split(".")[-1]
        if plain: kind = "vec"
        elif leaf in enums: kind = "enum1" if width == 1 else "enum"
        starts.append(("var", p, width, kind, bits, reset, init))
    if not starts: return None
    L = ["// written by dewfpga sim: the registers and memories of %s that have no start value start as the board" % top,
         "// starts them (the reset value; 0 without a reset; a memory word at 0). https://nosey-dewdrop.github.io/dewfpga/errors/sim-starts-as-board/",
         "module dewfpga_start;",
         f"  reg [{max([r[2] for r in starts if r[0] == 'var'] + [r[4] for r in starts if r[0] == 'mem'] + [1]) - 1}:0] t; integer k, j;",
         "  initial begin", "    #0;"]
    unset = lambda b: f"({b} !== 1'b0 && {b} !== 1'b1)"
    for r in starts:
        if r[0] == "mem":
            _, name, off, size, width, _ = r; w = f"{base}.{name}[k]"
            L.append(f"    for (k = {off}; k < {off + size}; k++) begin t = {{{w}}}; for (j = 0; j < {width}; j++) if (t[j] === 1'bx) t[j] = 1'b0; {{{w}}} = t[{width - 1}:0]; end")
            continue
        _, p, width, kind, bits, _, _ = r; s = f"{base}.{p}"
        if kind == "enum":
            for _, idx, v in bits: L.append(f"    if ({s}[{idx}] === 1'bx) {s}[{idx}] = 1'b{v};")
        elif kind == "enum1":
            v = bits[0][2]
            L.append(f"    if ({s} === 1'bx) begin if ({s}.first() == 1'b{v}) {s} = {s}.first(); else if ({s}.last() == 1'b{v}) {s} = {s}.last(); end")
        else:
            L.append(f"    t = {{{s}}}; " + " ".join(f"if {unset(f't[{i}]')} t[{i}] = 1'b{v};" for i, _, v in bits) + f" {{{s}}} = t[{width - 1}:0];")
    L += ["  end", "endmodule", ""]
    with open(f"{top}_start.sv", "w") as f: f.write("\n".join(L))
    # the note: up to four names with their start values, grouped by why (reset value, no reset, a LUT RAM)
    def value(r):
        _, p, width, kind, bits, reset, init = r
        vec = ["0"] * width
        for i, _, v in bits: vec[width - 1 - i] = v
        for i in range(width):
            if init and i < len(init) and init[-1 - i] in "01": vec[width - 1 - i] = init[-1 - i]
        return "0" if set(vec) == {"0"} else f"{width}'b{''.join(vec)}"
    vars_ = [r for r in starts if r[0] == "var"]; mems = [r for r in starts if r[0] == "mem"]
    shown, rest = (vars_ + mems)[:4], len(starts) - min(4, len(starts))
    groups = []
    with_reset = [f"{r[1]} at {value(r)}" for r in shown if r[0] == "var" and r[5]]
    no_reset = [f"{r[1]} at {value(r)}" for r in shown if r[0] == "var" and not r[5]]
    mem_shown = [f"{r[1]} at 0" for r in shown if r[0] == "mem"]
    join = lambda xs: xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " and " + xs[-1]
    if with_reset: groups.append(join(with_reset) + (" (its reset value)" if len(with_reset) == 1 else " (their reset values)"))
    if no_reset: groups.append(join(no_reset) + " (no reset)")
    if mem_shown: groups.append(join(mem_shown) + (" (a LUT RAM)" if len(mem_shown) == 1 else " (LUT RAMs)"))
    what = ", ".join(groups) + (f" and {rest} more" if rest else "")
    nv, nm = len(vars_), len(mems)
    subj = " and ".join(([f"{nv} register{'s' if nv != 1 else ''}"] if nv else []) + ([f"{nm} memor{'ies' if nm != 1 else 'y'}"] if nm else []))
    verb = "starts" if nv + nm == 1 else "start"
    # the fix, written for a register without a reset first (= 0 is what it gets anyway), else the first one, else a memory
    if vars_:
        r = next((r for r in vars_ if not r[5]), vars_[0]); leaf = r[1].split(".")[-1]
        if leaf in enums and enums[leaf][0]: fix = f"{enums[leaf][0]} {leaf} = {enums[leaf][1]};"
        elif leaf in enums: fix = f"{leaf} = {enums[leaf][1]};  in its declaration"
        else: fix = f"logic {leaf} = 0;" if r[2] == 1 else f"logic [{r[2] - 1}:0] {leaf} = 0;"
    else:
        r = mems[0]; fix = f"initial for (int i = 0; i < {r[3]}; i++) {r[1]}[i] = 0;"
    note = (f"{subj} without a start value {verb} as the board does, not at x: {what}. Vivado's simulator shows x there "
            f"until the first reset; a start value in the declaration ({fix}) is honoured by every tool (UG901 v2022.2 Ch.4 p.79).")
    # a partially loaded table ($readmemh with a start and an end address, or a file shorter than the memory): the
    # words it did not load are not started, since the build keeps no value for them (yosys folds them as don't-care)
    for _, name, off, size, width, init in partial:
        words = [init[len(init) - (k + 1) * width:len(init) - k * width] for k in range(size)]
        n = sum(1 for w in words if set(w) - set("01"))
        note += (f" {name}: {n} of its {size} words were given no value and stay x; the build treats such a word as a free choice "
                 f"(the netlist and the board read some value there, not 0), so load every word, or fill the table first "
                 f"(initial begin for (int i = 0; i < {size}; i++) {name}[i] = 0; $readmemh(...); end).")
    return note


if __name__ == "__main__":
    plain = "--plain" in sys.argv[1:]
    argv = [a for a in sys.argv[1:] if a != "--plain"]
    if len(argv) < 3: sys.exit("usage: sim_starts.py [--plain] <regs.json> <tb file> <top> <source files...>")
    top = argv[2]
    try:
        note = main(argv[0], argv[1], top, argv[3:], plain)
    except Exception:
        note = None
    if note: print(note)
    else:
        try: os.remove(f"{top}_start.sv")
        except OSError: pass
