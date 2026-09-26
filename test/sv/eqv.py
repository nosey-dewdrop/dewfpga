#!/usr/bin/env python3
"""Write an equivalence testbench: the probe's RTL (module top, read by iverilog) and the product's netlist
(module top_net, from top.json) get the same inputs, and every output bit the RTL knows (0 or 1) must have
the same value in the netlist; an x or a z there counts as different (an output yosys left undriven).
Both start as the board does. The netlist (--netlist, below): a register without a start value starts at
its primitive's default, not x. The RTL: every register bit that is still x once the RTL's own start values
are set gets the same default (rtl_starts, below), so a case or an if on a register nobody set cannot take
a branch the board never takes. With a clock, the bench first holds every button, and every input bit that
resets a register of the RTL (sw[15] in if (sw[15]) s <= IDLE, at its active level; rtl_resets, below), for
one clock edge and compares from then on, as a student presses reset after loading the board: a state
machine yosys re-encoded (one-hot) starts in no state at all on the board, and only its reset puts it in one,
whatever the reset is called. After that every difference counts, so a netlist that ignores its reset fails.
One exception, decided for the whole run, never per compare or per bit: the run also passes when the netlist
follows a second copy of the RTL that the bench does not start (x wherever the RTL gives no start value, as
dewfpga sim runs it) at every compare, equal to the first copy while a register bit of the second is still x
and equal to the second, every bit the first knows known in it too, once none is. The board then does what
the student's simulation shows: a register without a start value that yosys moved into a ROM can start the
board one clock off the usual 0 (a Lab 4 Gray counter). While a register of that copy is x, a case on it
takes its default, a branch no board takes, so its outputs prove nothing then; and a netlist that follows
one copy at some compares and the other at others follows neither.
A testbench checks a few vectors; this checks every input combination, all-zero included,
when there are 16 input bits or fewer (buttons included) and no clock, and 4096 random cycles otherwise, so
a fault on one input pattern shows. A random cycle draws its values with a bias: all zeros, all ones, mostly
zeros, mostly ones, or even odds, so a fault that needs every switch up (a counter's carry out) or all but
one shows too. The inputs change one bit at a time (a Gray-code walk; or, per random cycle, every bit gets
its new value in turn), and with a clock the buttons apart from the other inputs, so a latch's gate and its
data, or a reset and its data, never change in the same instant: that would be a race in any simulator,
not a synthesis fault. Every name the bench declares has a prefix (i_, r_, x_, n_, d_, e_, eqv_), so a port
named like one of them (x, mode, seed) cannot clash.
Usage: eqv.py [--bits a,b] top.json rtl.json > eqv.sv     (prints 'EQV PASS: ...' or 'EQV FAIL: ...' when
                                              simulated; rtl.json: the RTL read by yosys up to proc, see
                                              rtl_starts; --bits: the registers to start bit by bit, see main)
       eqv.py --netlist top.json > net_eqv.json     (the netlist the bench compares, see netlist())"""
import json, re, sys

CYCLES = 4096          # random cycles, and the least number of Gray-code steps
EXHAUSTIVE_BITS = 16
# flip-flops that start at 1 when their INIT is x. nextpnr-xilinx (xilinx/fasm.cc, commit 3fd7878):
# `int def_init = (type == "FDSE" || type == "FDSE_1" || type == "FDPE" || type == "FDPE_1") ? 1 : 0;`,
# so FDRE, FDCE and both latches, LDCE and LDPE, start at 0
STARTS_AT_1 = {"FDSE", "FDSE_1", "FDPE", "FDPE_1"}

def netlist(path):
    """top.json as the bench simulates it. Every design module is renamed <name>_net (top becomes top_net), so
    a submodule yosys kept (keep_hierarchy) does not clash with the RTL's module of the same name, and every
    INIT with an x in it gets what the bitstream holds: a flip-flop or latch its primitive's default, any
    other cell (a LUT, a LUT RAM, a shift register) 0 for each x bit, as nextpnr-xilinx writes them."""
    d = json.load(open(path))
    # the cell library (LUT2, FDRE, ...) is in the file too, as blackboxes; only the design's modules are renamed
    lib = lambda mod: any(str(mod.get("attributes", {}).get(a, "0")).strip("0 ") for a in ("blackbox", "whitebox"))
    design = {m: mod for m, mod in d["modules"].items() if not lib(mod)}
    out = {m: mod for m, mod in d["modules"].items() if m not in design}
    for m, mod in design.items():
        for c in mod.get("cells", {}).values():
            if c["type"] in design: c["type"] += "_net"
            for k, v in c.get("parameters", {}).items():
                # a bit-vector parameter is a string of 0/1/x/z; a string parameter of 0s and 1s gets a trailing space
                if (k == "INIT" or k.startswith("INIT_")) and isinstance(v, str) and v \
                        and not set(v) - set("01xz") and set(v) - set("01"):
                    if c["type"].startswith(("FD", "LD")):
                        c["parameters"][k] = "1" if c["type"] in STARTS_AT_1 else "0"
                    else:
                        c["parameters"][k] = v.replace("x", "0").replace("z", "0")
        out[m + "_net"] = mod
    d["modules"] = out
    json.dump(d, sys.stdout)

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

def rtl_starts(path):
    """The RTL's registers, from the RTL read by yosys up to proc (flatten; memory_collect; opt_dff), as
    ("var", path, width, kind, bits) and ("mem", name, first, words, width). path is the name iverilog
    knows under the RTL instance (u_fsm.state for a submodule's register); bits holds (i, index, value) for each
    register bit of it: i its place in the whole variable (0 = the right-most bit), index its bit select,
    value the board's start for that bit: 1 where a synchronous or asynchronous reset sets the bit to 1 (yosys
    maps it to FDSE or FDPE), else 0 (FDRE, FDCE, a latch, a LUT RAM). The bench sets each one only while it
    is x, so a start value the RTL gives itself stays. kind says how iverilog lets the bench write it: "enum"
    (a variable of one enum type takes no vector without a cast, but a bit select), "enum1" (a 1-bit enum takes
    neither, only one of its items), "vec" (anything else, written whole, since a bit select of a packed array
    of enums or of logic [1:0][3:0] picks an element, not a bit). A bit that several names share (assign w =
    q;, wire [3:0] low = led[3:0]) gets the name its always block writes; a name iverilog does not know
    makes the bench fail to compile, which the runner reports as a fail, never as a pass. The names looked at
    first are those of the module the always block is in (a register n of top that feeds a submodule's input
    port D is also called A1.D after flatten, a net, and so is a top wire q that a submodule's register q
    drives): each instance's module source comes from yosys' $scopeinfo cells, top's from its own src."""
    mod = json.load(open(path))["modules"]["top"]
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
        info[p] = (len(bits), kind)
        for i, b in enumerate(bits):
            if isinstance(b, int):
                idx = None if len(bits) == 1 else (off + len(bits) - 1 - i if upto else off + i)
                names.setdefault(b, []).append((n in ports, p, idx, i))
    out, seen, regs = [], set(), {}
    for c in mod["cells"].values():
        t, prm = c["type"], c.get("parameters", {})
        if t == "$mem_v2":
            name = prm["MEMID"].lstrip("\\")
            if "$" in name: continue
            size, off, width = int(prm["SIZE"], 2), int(prm["OFFSET"], 2), int(prm["WIDTH"], 2)
            out.append(("mem", name, off, size, width))
            continue
        if not re.match(r"\$(a|s|al)?(dff|dlatch|sr)", t) or "Q" not in c["connections"]: continue
        # a flip-flop's reset value decides FDSE/FDPE (1) or FDRE/FDCE (0); a latch starts at 0 either way
        rv = "" if "latch" in t else prm.get("SRST_VALUE") or prm.get("ARST_VALUE") or ""
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
            port, p, idx, at = cands[0]
            v = rv[-1 - i] if i < len(rv) and rv[-1 - i] in "01" else "0"
            regs.setdefault(p, []).append((at, idx, v))
    return out + [("var", p, *info[p], bits) for p, bits in regs.items()]

def rtl_resets(path):
    """The input bits that reset a register of the RTL, from the same listing as rtl_starts: the SRST or ARST of
    each flip-flop and latch yosys made, when it is a bit of one of top's inputs, as (port, i, level): i the
    bit's place in the port (0 = the right-most bit), level the value that resets. A reset built from logic
    (sw[15] & sw[14]) is no input bit and is not listed."""
    mod = json.load(open(path))["modules"]["top"]
    where = {}
    for n, p in mod.get("ports", {}).items():
        if p["direction"] == "input":
            for i, b in enumerate(p["bits"]): where[b] = (n, i)
    out = []
    for c in mod["cells"].values():
        for pin in ("SRST", "ARST"):
            b = c.get("connections", {}).get(pin, [None])[0]
            if b in where:
                lvl = str(c.get("parameters", {}).get(pin + "_POLARITY", "1"))[-1:]
                if lvl in "01" and (*where[b], lvl) not in out: out.append((*where[b], lvl))
    return out

def main(path, rtl_path, bits=()):
    """bits: registers (their rtl_starts path) started one bit select at a time instead of whole. iverilog refuses
    to write a variable whole when an assign drives other bits of it (always_ff ... led[3:0] <= ...; assign
    led[15:4] = sw[15:4]), and it names each such variable; eqv.sh then writes the bench again with them here.
    A bit select of a packed array of more than one dimension picks an element, so such a variable fails the
    bench instead (eqv_nostart)."""
    mods = json.load(open(path))["modules"]
    top = next((m for m in mods.values() if m.get("attributes", {}).get("top")), None) or mods["top"]
    ports = [(n, p["direction"], len(p["bits"])) for n, p in top["ports"].items()]
    clk = next((n for n, d, w in ports if d == "input" and w == 1 and n.lower() == "clk"), None)
    btns = [n for n, d, w in ports if d == "input" and w == 1 and n.lower().startswith("btn")]
    ins = [(n, w) for n, d, w in ports if d == "input" and n != clk]
    data = [(n, w) for n, w in ins if n not in btns]
    outs = [(n, w) for n, d, w in ports if d == "output"]
    ios = [(n, w) for n, d, w in ports if d == "inout"]
    # the data bits the walk moves: plain inputs, then each inout's outside driver and its enable
    walk = [("i_" + n, w) for n, w in data] + [("d_" + n, w) for n, w in ios] + [("e_" + n, w) for n, w in ios]
    nbits = sum(w for _, w in walk)
    # without a clock, a Gray-code walk changes one bit at a time, buttons included, so they join it
    gray = not clk and 0 < nbits + len(btns) <= EXHAUSTIVE_BITS
    if gray:
        walk = walk + [("i_" + b, 1) for b in btns]; nbits += len(btns)
    L = ["`timescale 1ns/1ps", "module eqv;"]
    if clk: L.append(f"  reg i_{clk} = 1'b0;")
    for n, w in ins: L.append(f"  reg [{w-1}:0] i_{n} = '0;")
    for n, w in outs: L.append(f"  wire [{w-1}:0] r_{n}, x_{n}, n_{n};")
    for n, w in ios:
        # the pin is driven from outside on the bits whose enable is 1, and read back by every design
        L.append(f"  wire [{w-1}:0] r_{n}, x_{n}, n_{n}; reg [{w-1}:0] d_{n} = '0, e_{n} = '0;")
        L.append(f"  genvar g_{n}; for (g_{n} = 0; g_{n} < {w}; g_{n}++) begin : drv_{n}")
        for sfx in "rxn": L.append(f"    assign {sfx}_{n}[g_{n}] = e_{n}[g_{n}] ? d_{n}[g_{n}] : 1'bz;")
        L.append("  end")
    conn = lambda sfx: ", ".join([f".{clk}(i_{clk})"] * bool(clk) + [f".{n}(i_{n})" for n, _ in ins]
                                 + [f".{n}({sfx}_{n})" for n, _ in outs + ios])
    # eqv_rtl starts as the board does (below); eqv_rtx is the same RTL as dewfpga sim starts it, x where it
    # gives no start value
    L.append(f"  top     eqv_rtl ({conn('r')});")
    L.append(f"  top     eqv_rtx ({conn('x')});")
    L.append(f"  top_net eqv_net ({conn('n')});")
    if walk: L.append(f"  reg [{nbits-1}:0] eqv_v = '0;")
    starts = rtl_starts(rtl_path)
    # a register or memory word is read into eqv_t, its x bits set, and written back whole; eqv_u reads eqv_rtx's
    L.append(f"  reg [{max([r[2] for r in starts if r[0] == 'var'] + [r[4] for r in starts if r[0] == 'mem'] + [1]) - 1}:0] eqv_t, eqv_u;")
    L.append("  integer eqv_seed = 1, eqv_bad = 0, eqv_cmp = 0, eqv_sim = 0, eqv_xrun = 0, eqv_nostart = 0, eqv_shown = 0, "
             "eqv_b0, eqv_bx, eqv_res, eqv_k, eqv_i, eqv_j, eqv_mode;")
    shown = [(m, "i_" + m) for m, _ in ins] + [(q + "_d", "d_" + q) for q, _ in ios]
    # one compare: every output bit eqv_rtl knows. eqv_b0 counts those the netlist has otherwise, eqv_bx those
    # where eqv_rtx is not 0 or 1 or differs from the netlist, and eqv_res says whether every register bit of
    # eqv_rtx is known (memories aside). eqv_bad adds up eqv_b0: 0 at the end, and the netlist follows the RTL as
    # the board starts it. eqv_xrun counts the compares where it does not follow eqv_rtx (while eqv_res is 0,
    # that is eqv_rtl): 0 at the end, and it follows the RTL as dewfpga sim starts it, the one exception (a
    # register without a start value that yosys moved, as into a ROM, can start the board one clock off its
    # usual 0). eqv_sim counts the compares only that run explains
    L.append("  task eqv_check(input [8*6-1:0] eqv_when); begin")
    L.append("    eqv_b0 = 0; eqv_bx = 0; eqv_res = 1;")
    for n, w in outs + ios:
        L.append(f"    for (eqv_k = 0; eqv_k < {w}; eqv_k++) if (r_{n}[eqv_k] === 1'b0 || r_{n}[eqv_k] === 1'b1) begin eqv_cmp++;")
        L.append(f"      if (n_{n}[eqv_k] !== r_{n}[eqv_k]) eqv_b0++; if (!(x_{n}[eqv_k] === 1'b0 || x_{n}[eqv_k] === 1'b1) || n_{n}[eqv_k] !== x_{n}[eqv_k]) eqv_bx++; end")
    for r in starts:
        # a register bit of eqv_rtx still x (or z): the reduction of its bits, masked, is x
        if r[0] != "var": continue
        _, p, width, _, rbits = r
        mask = "".join("1" if any(i == j for j, _, _ in rbits) else "0" for i in reversed(range(width)))
        L.append(f"    eqv_u = {{eqv_rtx.{p}}}; if (^(eqv_u[{width-1}:0] & {width}'b{mask}) === 1'bx) eqv_res = 0;")
    L.append("    eqv_bad = eqv_bad + eqv_b0;")
    L.append("    if (eqv_res ? eqv_bx != 0 : eqv_b0 != 0) eqv_xrun++; else if (eqv_b0) eqv_sim++;")
    # the bits of a compare that neither run explains
    L.append("    if (eqv_b0 && !(eqv_res && !eqv_bx)) begin")
    for n, w in outs + ios:
        L.append(f"      for (eqv_k = 0; eqv_k < {w}; eqv_k++) if ((r_{n}[eqv_k] === 1'b0 || r_{n}[eqv_k] === 1'b1) && n_{n}[eqv_k] !== r_{n}[eqv_k]) begin")
        L.append(f"        eqv_shown++; if (eqv_shown <= 5) $display(\"EQV MISMATCH at %0t (%0s): "
                 f"{n}[%0d] rtl %b, netlist %b; inputs{''.join(f' {m}=%h' for m, _ in shown)}\", "
                 f"$time, eqv_when, eqv_k, r_{n}[eqv_k], n_{n}[eqv_k]{''.join(f', {s}' for _, s in shown)}); end")
    L.append("    end")
    L.append("  end endtask")
    # the RTL starts where the board does (rtl_starts): only the bits the RTL left x, after its own start values.
    # A register bit that shares its variable with an assign starts as z in iverilog, so z counts as unset too
    unset = lambda b: f"({b} !== 1'b0 && {b} !== 1'b1)"
    L.append("  initial begin")
    L.append("    #0.5;")
    bits_of = set(bits)
    for r in starts:
        if r[0] == "mem":
            _, name, off, size, width = r
            w = f"eqv_rtl.{name}[eqv_k]"
            L.append(f"    for (eqv_k = {off}; eqv_k < {off + size}; eqv_k++) begin eqv_t = {{{w}}}; "
                     f"for (eqv_j = 0; eqv_j < {width}; eqv_j++) if (eqv_t[eqv_j] === 1'bx) eqv_t[eqv_j] = 1'b0; {{{w}}} = eqv_t[{width-1}:0]; end")
            continue
        _, p, width, kind, bits = r
        s = f"eqv_rtl.{p}"
        if kind == "enum":
            for _, idx, v in bits: L.append(f"    if ({s}[{idx}] === 1'bx) {s}[{idx}] = 1'b{v};")
        elif kind == "enum1":
            # the item with the board's value, reached through the variable itself (a 1-bit enum has at most two
            # items, its first and its last), so it does not matter where the enum is declared: a submodule, the
            # file. None (an enum without that value) leaves the RTL's x
            v = bits[0][2]
            L.append(f"    if ({s} === 1'bx) begin if ({s}.first() == 1'b{v}) {s} = {s}.first(); "
                     f"else if ({s}.last() == 1'b{v}) {s} = {s}.last(); end")
        elif p in bits_of:
            L.append(f"    if ($dimensions({s}) != 1) eqv_nostart = 1; else begin "
                     + " ".join(f"if {unset(f'{s}[{idx}]')} {s}[{idx}] = 1'b{v};" for _, idx, v in bits) + " end")
        else:
            L.append(f"    eqv_t = {{{s}}}; " + " ".join(f"if {unset(f'eqv_t[{i}]')} eqv_t[{i}] = 1'b{v};" for i, _, v in bits)
                     + f" {{{s}}} = eqv_t[{width-1}:0];")
    L.append("  end")
    # a button is often a reset: high one cycle in eight, so the logic behind it runs too
    setb = " ".join(f"i_{b} = (($random(eqv_seed) & 7) == 0);" for b in btns)
    unpack = "{" + ", ".join(n for n, _ in walk) + "} = eqv_v;" if walk else ""
    L.append("  initial begin")
    L.append("    #1;")
    if gray:
        # from i = 0: Gray(0) is the all-zero input, and 2^n steps visit each of the 2^n values once
        steps = max(1 << nbits, CYCLES)
        L.append(f"    for (eqv_i = 0; eqv_i < {steps}; eqv_i++) begin eqv_v = eqv_i ^ (eqv_i >> 1); {unpack} #2 eqv_check(\"gray\"); #3; end")
    else:
        # the reset a student presses after loading the board: every button, and every input bit that resets a
        # register (at its active level), held for one clock edge
        press = [(f"i_{b}", "1") for b in btns] + [(f"i_{n}[{i}]", lvl) for n, i, lvl in rtl_resets(rtl_path)
                                                   if n != clk and n not in btns and n in dict(ins)]
        if clk and press:
            L.append(f"    {' '.join(f'{b} = {v};' for b, v in press)} #2 i_{clk} = 1'b1; #3 i_{clk} = 1'b0; "
                     f"#2 {' '.join(f'{b} = 0;' for b, _ in press)} #3;")
        L.append(f"    for (eqv_i = 0; eqv_i < {CYCLES}; eqv_i++) begin")
        # the cycle's bias: 0 all zeros, 1 all ones, 2 one bit in eight set, 3 seven in eight, else even odds
        L.append("      eqv_mode = $random(eqv_seed) & 7;")
        if walk: L.append(f"      for (eqv_j = 0; eqv_j < {nbits}; eqv_j++) begin eqv_v[eqv_j] = eqv_mode == 0 ? 1'b0 : eqv_mode == 1 ? 1'b1 : "
                          f"eqv_mode == 2 ? (($random(eqv_seed) & 7) == 0) : eqv_mode == 3 ? (($random(eqv_seed) & 7) != 0) : $random(eqv_seed); "
                          f"{unpack} #1; end #1 eqv_check(\"data\");")
        if btns: L.append(f"      #1 {setb} #2 eqv_check(\"btns\");")
        if clk: L.append(f"      #2 i_{clk} = 1'b1; #3 eqv_check(\"posedg\"); #2 i_{clk} = 1'b0; #3 eqv_check(\"negedg\");")
        L.append("      #5;")
        L.append("    end")
    L.append("    if (eqv_nostart) $display(\"EQV FAIL: the bench could not start a register that an assign shares its variable with "
             "(a packed array of more than one dimension)\");")
    L.append("    else if (eqv_cmp == 0) $display(\"EQV FAIL: no output bit was ever known in both, nothing compared\");")
    L.append("    else if (eqv_bad == 0) $display(\"EQV PASS: %0d output bits compared, all equal\", eqv_cmp);")
    L.append("    else if (eqv_xrun == 0) $display(\"EQV PASS: %0d output bits compared, all equal (at %0d compares to the RTL as dewfpga sim "
             "starts it, without start values, not as the board does)\", eqv_cmp, eqv_sim);")
    L.append("    else $display(\"EQV FAIL: %0d of %0d compared output bits differ between the RTL and the netlist%0s\", eqv_bad, eqv_cmp, "
             "eqv_shown ? \"\" : \" (at every compare it equals the RTL as the board starts it or as dewfpga sim starts it, not the same "
             "one throughout)\");")
    L.append("    $finish;")
    L.append("  end")
    L.append("endmodule")
    print("\n".join(L))

if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--netlist": netlist(sys.argv[2])
    elif len(sys.argv) == 3: main(sys.argv[1], sys.argv[2])
    elif len(sys.argv) == 5 and sys.argv[1] == "--bits": main(sys.argv[3], sys.argv[4], sys.argv[2].split(","))
    else: sys.exit("\n".join(__doc__.split("\n")[-3:]))
