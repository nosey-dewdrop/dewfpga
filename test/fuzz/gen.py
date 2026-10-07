#!/usr/bin/env python3
"""Random SystemVerilog designs in the language DDCA (Harris & Harris, ch. 4, 5, 7) and CS223 teach.

  gen.py <seed> <outdir> [--on f,g] [--off h] [--list]

Writes into <outdir>: top.sv (module top on Basys3 ports), zero or more submodule files, maybe fuzz_pkg.sv,
top.xdc (the master XDC's lines for the ports top has) and top_tb.sv (module tb: random stimulus for a few
hundred cycles, every output printed every cycle, no expected values). Deterministic per seed (python 3.9,
stdlib only). Every language feature is a switch in FEATURES: a seed draws them, --on/--off force them, so
a failing design can be narrowed to the feature that causes it. Nothing here claims what the design should
do: the RTL simulation is the reference, the netlist simulation is what the board would do.
"""
import random
import re
import sys

FEATURES = [
    # name                 probability   what it switches on
    ("always_comb",       0.7),   # always_comb with if/else chains
    ("case",              0.7),   # case in always_comb, with default
    ("case_nodefault",    0.4),   # case without default, the output given a value before it
    ("casez",             0.4),   # casez with ? wildcards
    ("unique_case",       0.4),   # unique case
    ("always_ff",         0.9),   # registers
    ("async_reset",       0.5),   # always_ff @(posedge clk or posedge btnC), else synchronous reset
    ("init_value",        0.4),   # a register with a start value in its declaration instead of a reset
    ("always_latch",      0.15),  # always_latch
    ("enum_fsm",          0.6),   # typedef enum state machine
    ("params",            0.7),   # parameter / localparam used in widths and values
    ("param_override",    0.5),   # #(.N(..)) at the instance
    ("gen_for",           0.5),   # generate for with a named block
    ("gen_if",            0.4),   # generate if on a parameter
    ("packed_array",      0.5),   # logic [3:0][3:0] with a variable index
    ("unpacked_array",    0.5),   # logic [7:0] t [0:3] of wires
    ("memory",            0.4),   # logic [W-1:0] mem [0:D-1] written on clk, read asynchronously
    ("struct",            0.5),   # typedef struct packed
    ("typedef",           0.5),   # typedef logic [W-1:0] word_t
    ("function",          0.6),   # function automatic with a for loop
    ("func_break",        0.4),   # break / continue in that loop
    ("comb_for",          0.4),   # for loop in always_comb (priority encoder)
    ("named_conn",        0.7),   # .a(b) instance connections; else positional
    ("star_conn",         0.3),   # .* connections
    ("package",           0.4),   # package with a localparam, a typedef, a function; import pkg::*
    ("package_own_file",  0.5),   # that package in its own file
    ("sub_own_file",      0.6),   # submodules in their own files
    ("signed",            0.5),   # logic signed, $signed, >>>
    ("shift",             0.7),   # << >> (>>> with signed)
    ("reduction",         0.6),   # &a |a ^a
    ("concat",            0.7),   # {a, b} and {N{a}}
    ("ternary",           0.7),   # c ? a : b
    ("clog2",             0.5),   # $clog2 in a width
    ("arith",             0.8),   # + - *
    ("compare",           0.7),   # < <= == != with 1-bit results
    ("implicit_width",    0.5),   # operands of different widths left to the context rules
    ("seg_an_dp",         0.5),   # top also drives seg, an, dp
    ("extra_buttons",     0.5),   # btnU/L/R/D as inputs
    ("deep",              0.6),   # three or four levels of modules instead of one or two
    ("multi_inst",        0.5),   # the same submodule instantiated twice
]
NAMES = [f for f, _ in FEATURES]

XDC = {
    "clk": ["set_property -dict { PACKAGE_PIN W5   IOSTANDARD LVCMOS33 } [get_ports clk]"],
    "sw": ["set_property -dict { PACKAGE_PIN %s   IOSTANDARD LVCMOS33 } [get_ports {sw[%d]}]" % (p, i) for i, p in enumerate(
        "V17 V16 W16 W17 W15 V15 W14 W13 V2 T3 T2 R3 W2 U1 T1 R2".split())],
    "led": ["set_property -dict { PACKAGE_PIN %s   IOSTANDARD LVCMOS33 } [get_ports {led[%d]}]" % (p, i) for i, p in enumerate(
        "U16 E19 U19 V19 W18 U15 U14 V14 V13 V3 W3 U3 P3 N3 P1 L1".split())],
    "seg": ["set_property -dict { PACKAGE_PIN %s   IOSTANDARD LVCMOS33 } [get_ports {seg[%d]}]" % (p, i) for i, p in enumerate(
        "W7 W6 U8 V8 U5 V5 U7".split())],
    "dp": ["set_property -dict { PACKAGE_PIN V7   IOSTANDARD LVCMOS33 } [get_ports dp]"],
    "an": ["set_property -dict { PACKAGE_PIN %s   IOSTANDARD LVCMOS33 } [get_ports {an[%d]}]" % (p, i) for i, p in enumerate(
        "U2 U4 V4 W4".split())],
    "btnC": ["set_property -dict { PACKAGE_PIN U18   IOSTANDARD LVCMOS33 } [get_ports btnC]"],
    "btnU": ["set_property -dict { PACKAGE_PIN T18   IOSTANDARD LVCMOS33 } [get_ports btnU]"],
    "btnL": ["set_property -dict { PACKAGE_PIN W19   IOSTANDARD LVCMOS33 } [get_ports btnL]"],
    "btnR": ["set_property -dict { PACKAGE_PIN T17   IOSTANDARD LVCMOS33 } [get_ports btnR]"],
    "btnD": ["set_property -dict { PACKAGE_PIN U17   IOSTANDARD LVCMOS33 } [get_ports btnD]"],
}


class Sig:
    def __init__(self, name, width, signed=False):
        self.name, self.width, self.signed = name, width, signed


class Gen:
    def __init__(self, seed, on, off):
        self.seed = seed
        self.rng = random.Random(seed)
        self.F = {}
        for name, p in FEATURES:
            self.F[name] = self.rng.random() < p
        for n in on:
            self.F[n] = True
        for n in off:
            self.F[n] = False
        self.files = {}           # file name -> text
        self.modules = []         # (name, text) in definition order (children first)
        self.pkg_text = None
        self.pkg_funcs = []       # (name, width) functions in the package
        self.pkg_params = []      # (name, value)
        self.counter = 0

    # ---------- helpers ----------
    def f(self, name):
        return self.F[name]

    def uid(self, base):
        self.counter += 1
        return "%s%d" % (base, self.counter)

    def chance(self, p):
        return self.rng.random() < p

    def pick(self, xs):
        return self.rng.choice(xs)

    # ---------- expressions ----------
    def sized(self, sig, width, ctx):
        """sig as an expression of exactly `width` bits (unless implicit_width, where the context decides)."""
        if sig.width == width:
            return sig.name
        if self.f("implicit_width") and self.chance(0.6):
            return sig.name
        if sig.width > width:
            return "%s[%d:0]" % (sig.name, width - 1)
        if self.f("concat"):
            return "{%d'b0, %s}" % (width - sig.width, sig.name) if not self.chance(0.5) \
                else "{{%d{1'b0}}, %s}" % (width - sig.width, sig.name)
        return sig.name

    def expr(self, width, ctx, depth=0):
        """A self-contained expression whose value is meant for a `width`-bit context."""
        sigs = ctx["sigs"]
        r = self.rng.random()
        if depth >= 2 or r < 0.25 or not sigs:
            if not sigs or self.chance(0.15):
                return "%d'd%d" % (width, self.rng.randrange(1 << min(width, 16)))
            return self.sized(self.pick(sigs), width, ctx)
        ops = ["bit"]
        if self.f("arith"): ops += ["add", "sub", "mul"]
        if self.f("shift"): ops += ["shl", "shr"]
        if self.f("ternary"): ops += ["tern"]
        if self.f("concat"): ops += ["cat", "rep"]
        if self.f("reduction"): ops += ["red"]
        if self.f("compare"): ops += ["cmp"]
        if self.f("signed"): ops += ["sgn"]
        if self.pkg_funcs and ctx.get("imp") and self.chance(0.3): ops += ["pkgf"]
        if ctx.get("funcs") and self.chance(0.4): ops += ["func"]
        op = self.pick(ops)
        a = lambda: self.expr(width, ctx, depth + 1)
        if op == "bit":
            o = self.pick(["&", "|", "^", "&", "|", "^", "~^"])
            if self.chance(0.2):
                return "(~%s)" % a()
            return "(%s %s %s)" % (a(), o, a())
        if op == "add":
            return "(%s + %s)" % (a(), a())
        if op == "sub":
            return "(%s - %s)" % (a(), a())
        if op == "mul":
            w = max(1, min(width, 8))
            return "(%s * %s)" % (self.expr(w, ctx, depth + 1), self.expr(w, ctx, depth + 1))
        if op == "shl":
            k = self.rng.randrange(0, max(1, width))
            if self.chance(0.4) and sigs:
                s = self.pick(sigs)
                return "(%s << %s)" % (a(), s.name if s.width <= 4 else "%s[1:0]" % s.name)
            return "(%s << %d)" % (a(), k)
        if op == "shr":
            k = self.rng.randrange(0, max(1, width))
            if self.f("signed") and self.chance(0.5):
                return "($signed(%s) >>> %d)" % (a(), k)
            return "(%s >> %d)" % (a(), k)
        if op == "tern":
            return "(%s ? %s : %s)" % (self.cond(ctx, depth + 1), a(), a())
        if op == "cat":
            w1 = self.rng.randrange(1, width) if width > 1 else 1
            w2 = max(1, width - w1)
            return "{%s, %s}" % (self.expr(w1, ctx, depth + 1), self.expr(w2, ctx, depth + 1))
        if op == "rep":
            n = self.pick([2, 3, 4])
            w1 = max(1, width // n)
            return "{%d{%s}}" % (n, self.expr(w1, ctx, depth + 1))
        if op == "red":
            s = self.pick(sigs)
            return "(%s%s)" % (self.pick(["&", "|", "^", "~&", "~|"]), s.name)
        if op == "cmp":
            return "(%s)" % self.cond(ctx, depth + 1)
        if op == "sgn":
            s = self.pick(sigs)
            k = self.rng.randrange(1, 4)
            c = self.pick(["($signed(%s) >>> %d)" % (s.name, k),
                           "($signed(%s) < 0 ? -$signed(%s) : $signed(%s))" % (s.name, s.name, s.name),
                           "($signed(%s) + $signed(%s))" % (s.name, self.pick(sigs).name),
                           "($signed(%s) * -3'sd2)" % s.name])
            return c
        if op == "pkgf":
            fn, fw = self.pick(self.pkg_funcs)
            return "%s(%s)" % (fn, self.expr(fw, ctx, depth + 1))
        if op == "func":
            fn, fw, nargs = self.pick(ctx["funcs"])
            return "%s(%s)" % (fn, ", ".join(self.expr(fw, ctx, depth + 1) for _ in range(nargs)))
        return a()

    def cond(self, ctx, depth=0):
        sigs = ctx["sigs"]
        if not sigs:
            return "1'b1"
        r = self.rng.random()
        if r < 0.3 or not self.f("compare"):
            s = self.pick(sigs)
            if s.width == 1:
                return s.name if self.chance(0.6) else "!%s" % s.name
            return "%s[%d]" % (s.name, self.rng.randrange(s.width)) if self.chance(0.6) else "(|%s)" % s.name
        a, b = self.pick(sigs), self.pick(sigs)
        op = self.pick(["<", "<=", ">", ">=", "==", "!="])
        if self.f("signed") and self.chance(0.3):
            return "($signed(%s) %s $signed(%s))" % (a.name, op, b.name)
        if self.chance(0.4):
            return "(%s %s %d'd%d)" % (a.name, op, a.width, self.rng.randrange(1 << min(a.width, 16)))
        return "(%s %s %s)" % (a.name, op, b.name)

    # ---------- statements ----------
    def decl(self, ctx, name, width, signed=False, init=None):
        t = ctx["wordt"] if (ctx.get("wordt") and ctx["wordw"] == width and self.chance(0.5)) else None
        if t:
            s = "  %s %s" % (t, name)
        elif width == 1:
            s = "  logic%s %s" % (" signed" if signed else "", name)
        else:
            s = "  logic%s [%s:0] %s" % (" signed" if signed else "", self.wexpr(ctx, width), name)
        if init is not None:
            s += " = %s" % init
        ctx["decls"].append(s + ";")

    def wexpr(self, ctx, width):
        """width-1 as a constant expression: a number, a parameter, or $clog2."""
        for pname, pval in ctx.get("params", []):
            if pval == width and self.chance(0.6):
                return "%s-1" % pname
            if pval == width + 1 and self.chance(0.3):
                return "%s-2" % pname
        if self.f("clog2") and self.chance(0.3) and width <= 16:
            return "$clog2(%d)-1" % (1 << width)
        return str(width - 1)

    def new_sig(self, ctx, width=None, signed=False):
        w = width or self.pick([1, 2, 3, 4, 4, 5, 8, 8, 12, 16])
        return Sig(self.uid("s"), w, signed)

    def stmt(self, ctx):
        """Add one construct defining a new signal; returns the signal."""
        kinds = ["assign", "assign"]
        if self.f("always_comb"): kinds += ["comb_if"]
        if self.f("case"): kinds += ["case"]
        if self.f("casez"): kinds += ["casez"]
        if self.f("always_ff"): kinds += ["reg", "reg"]
        if self.f("enum_fsm"): kinds += ["fsm"]
        if self.f("gen_for"): kinds += ["gen_for"]
        if self.f("gen_if") and ctx.get("params"): kinds += ["gen_if"]
        if self.f("packed_array"): kinds += ["packed"]
        if self.f("unpacked_array"): kinds += ["unpacked"]
        if self.f("memory") and self.f("always_ff"): kinds += ["memory"]
        if self.f("struct"): kinds += ["struct"]
        if self.f("comb_for"): kinds += ["comb_for"]
        if self.f("always_latch"): kinds += ["latch"]
        if self.f("function"): kinds += ["function"]
        k = self.pick(kinds)
        return getattr(self, "st_" + k)(ctx)

    def st_assign(self, ctx):
        s = self.new_sig(ctx, signed=self.f("signed") and self.chance(0.3))
        self.decl(ctx, s.name, s.width, s.signed)
        ctx["body"].append("  assign %s = %s;" % (s.name, self.expr(s.width, ctx)))
        return s

    def st_comb_if(self, ctx):
        s = self.new_sig(ctx)
        self.decl(ctx, s.name, s.width)
        b = ctx["body"]
        b.append("  always_comb begin")
        n = self.rng.randrange(1, 4)
        for i in range(n):
            b.append("    %s (%s) %s = %s;" % ("if" if i == 0 else "else if", self.cond(ctx), s.name, self.expr(s.width, ctx)))
        b.append("    else %s = %s;" % (s.name, self.expr(s.width, ctx)))
        b.append("  end")
        return s

    def st_case(self, ctx, z=False):
        s = self.new_sig(ctx)
        self.decl(ctx, s.name, s.width)
        b = ctx["body"]
        sel = self.pick(ctx["sigs"]) if ctx["sigs"] else None
        if sel is None:
            return self.st_assign(ctx)
        sw = min(sel.width, 4)
        selx = sel.name if sel.width <= 4 else "%s[3:0]" % sel.name
        nodef = self.f("case_nodefault") and self.chance(0.5)
        b.append("  always_comb begin")
        if nodef:
            b.append("    %s = %s;" % (s.name, self.expr(s.width, ctx)))
        kw = "unique case" if (self.f("unique_case") and self.chance(0.5) and not nodef) else "case"
        if z:
            kw = kw.replace("case", "casez")
        b.append("    %s (%s)" % (kw, selx))
        items = self.rng.randrange(1, min(4, 1 << sw) + 1)
        used = set()
        for _ in range(items):
            if z:
                pat = "".join(self.pick(["0", "1", "?"]) for _ in range(sw))
                if pat in used:
                    continue
                used.add(pat)
                lab = "%d'b%s" % (sw, pat)
            else:
                v = self.rng.randrange(1 << sw)
                if v in used:
                    continue
                used.add(v)
                lab = "%d'd%d" % (sw, v)
                if self.chance(0.2) and (1 << sw) > 2:
                    v2 = self.rng.randrange(1 << sw)
                    if v2 not in used:
                        used.add(v2)
                        lab += ", %d'd%d" % (sw, v2)
            b.append("      %s: %s = %s;" % (lab, s.name, self.expr(s.width, ctx)))
        if not nodef:
            b.append("      default: %s = %s;" % (s.name, self.expr(s.width, ctx)))
        b.append("    endcase")
        b.append("  end")
        return s

    def st_casez(self, ctx):
        return self.st_case(ctx, z=True)

    def reg_header(self, ctx, body):
        """The always_ff line and the reset branch; returns (needs_else, indent)."""
        if ctx.get("rst") and not (self.f("init_value") and self.chance(0.5)):
            if self.f("async_reset") and self.chance(0.6):
                body.append("  always_ff @(posedge %s or posedge %s)" % (ctx["clk"], ctx["rst"]))
            else:
                body.append("  always_ff @(posedge %s)" % ctx["clk"])
            return True
        body.append("  always_ff @(posedge %s)" % ctx["clk"])
        return False

    def st_reg(self, ctx):
        if not ctx.get("clk"):
            return self.st_assign(ctx)
        s = self.new_sig(ctx)
        b = ctx["body"]
        has_rst = self.reg_header(ctx, b)
        self.decl(ctx, s.name, s.width, init=None if has_rst else "%d'd%d" % (s.width, self.rng.randrange(1 << min(s.width, 16))))
        kind = self.pick(["load", "count", "enable", "shift"])
        inner = []
        if kind == "load":
            inner.append("%s <= %s;" % (s.name, self.expr(s.width, ctx)))
        elif kind == "count":
            inner.append("%s <= %s + 1'b1;" % (s.name, s.name))
        elif kind == "enable":
            inner.append("if (%s) %s <= %s;" % (self.cond(ctx), s.name, self.expr(s.width, ctx)))
        else:
            inner.append("%s <= {%s[%d:0], %s};" % (s.name, s.name, max(0, s.width - 2), self.cond(ctx)) if s.width > 1
                         else "%s <= %s;" % (s.name, self.cond(ctx)))
        if has_rst:
            b.append("    if (%s) %s <= %s;" % (ctx["rst"], s.name, self.pick(["'0", "%d'd0" % s.width, "0"])))
            b.append("    else begin")
            for l in inner:
                b.append("      " + l)
            b.append("    end")
        else:
            b.append("    begin")
            for l in inner:
                b.append("      " + l)
            b.append("    end")
        ctx["sigs"].append(s)      # a register may feed itself and earlier logic
        return s

    def st_fsm(self, ctx):
        if not ctx.get("clk"):
            return self.st_assign(ctx)
        n = self.pick([2, 3, 4, 5])
        tname = self.uid("state_t")
        names = ["%s_S%d" % (tname.upper(), i) for i in range(n)]
        w = max(1, (n - 1).bit_length())
        enc = ""
        if self.chance(0.5):
            enc = " logic [%d:0]" % (w - 1)
        if enc and self.chance(0.5):
            vals = ", ".join("%s = %d'd%d" % (nm, w, i) for i, nm in enumerate(names))
        elif self.chance(0.3):
            vals = ", ".join("%s = %d" % (nm, i) for i, nm in enumerate(names))
        else:
            vals = ", ".join(names)
        ctx["decls"].append("  typedef enum%s {%s} %s;" % (enc, vals, tname))
        st, nx = self.uid("state"), self.uid("next")
        b = ctx["body"]
        has_rst = self.reg_header(ctx, b)
        if has_rst:
            ctx["decls"].append("  %s %s, %s;" % (tname, st, nx))
            b.append("    if (%s) %s <= %s;" % (ctx["rst"], st, names[0]))
            b.append("    else %s <= %s;" % (st, nx))
        else:
            ctx["decls"].append("  %s %s = %s, %s;" % (tname, st, names[0], nx))
            b.append("    %s <= %s;" % (st, nx))
        b.append("  always_comb begin")
        if self.chance(0.5):
            b.append("    %s = %s;" % (nx, st))
            kw = "case"
        else:
            kw = "unique case" if self.f("unique_case") and self.chance(0.5) else "case"
        b.append("    %s (%s)" % (kw, st))
        for i, nm in enumerate(names):
            if self.chance(0.6):
                b.append("      %s: if (%s) %s = %s; else %s = %s;" % (nm, self.cond(ctx), nx, names[(i + 1) % n], nx, self.pick(names)))
            else:
                b.append("      %s: %s = %s;" % (nm, nx, names[(i + 1) % n]))
        b.append("      default: %s = %s;" % (nx, names[0]))
        b.append("    endcase")
        b.append("  end")
        s = Sig(self.uid("s"), w)
        self.decl(ctx, s.name, s.width)
        if self.chance(0.5):
            b.append("  assign %s = (%s == %s) ? %d'd%d : %d'd%d;" % (s.name, st, self.pick(names), w, self.rng.randrange(1 << w), w, self.rng.randrange(1 << w)))
        else:
            b.append("  assign %s = %s;" % (s.name, st))
        return s

    def st_gen_for(self, ctx):
        n = self.pick([2, 4, 8])
        s = Sig(self.uid("s"), n)
        self.decl(ctx, s.name, n)
        srcs = [x for x in ctx["sigs"] if x.width >= n]
        if not srcs:
            return self.st_assign(ctx)
        a, c = self.pick(srcs), self.pick(srcs)
        g = self.uid("g")
        b = ctx["body"]
        if self.chance(0.5):
            b.append("  genvar %s_i;" % g)
            b.append("  generate for (%s_i = 0; %s_i < %d; %s_i = %s_i + 1) begin : %s" % (g, g, n, g, g, g))
        else:
            b.append("  for (genvar %s_i = 0; %s_i < %d; %s_i++) begin : %s" % (g, g, n, g, g))
        op = self.pick(["&", "|", "^"])
        b.append("    assign %s[%s_i] = %s[%s_i] %s %s[%d - %s_i];" % (s.name, g, a.name, g, op, c.name, n - 1, g))
        b.append("  end" + (" endgenerate" if "generate" in b[-2] else ""))
        return s

    def st_gen_if(self, ctx):
        pname, pval = self.pick(ctx["params"])
        s = self.new_sig(ctx)
        self.decl(ctx, s.name, s.width)
        b = ctx["body"]
        thr = self.pick([2, 4, 8])
        g = self.uid("gi")
        b.append("  generate if (%s > %d) begin : %s" % (pname, thr, g))
        b.append("    assign %s = %s;" % (s.name, self.expr(s.width, ctx)))
        b.append("  end else begin : %s_else" % g)
        b.append("    assign %s = %s;" % (s.name, self.expr(s.width, ctx)))
        b.append("  end endgenerate")
        return s

    def st_packed(self, ctx):
        rows, cols = self.pick([(2, 4), (4, 4), (2, 8), (4, 2)])
        arr = self.uid("pa")
        ctx["decls"].append("  logic [%d:0][%d:0] %s;" % (rows - 1, cols - 1, arr))
        b = ctx["body"]
        b.append("  assign %s = %s;" % (arr, self.expr(rows * cols, ctx)))
        s = Sig(self.uid("s"), cols)
        self.decl(ctx, s.name, cols)
        idx = self.idx(ctx, rows)
        b.append("  assign %s = %s[%s];" % (s.name, arr, idx))
        return s

    def idx(self, ctx, n):
        """An index expression that stays inside 0..n-1."""
        iw = max(1, (n - 1).bit_length())
        srcs = [x for x in ctx["sigs"] if x.width >= iw]
        if not srcs:
            return "%d'd%d" % (iw, self.rng.randrange(n))
        s = self.pick(srcs)
        if n & (n - 1) == 0:
            return s.name if s.width == iw else "%s[%d:0]" % (s.name, iw - 1)
        return "%s[%d:0] %% %d" % (s.name, iw - 1, n) if s.width > iw else "%s %% %d" % (s.name, n)

    def st_unpacked(self, ctx):
        n, w = self.pick([(4, 8), (2, 4), (4, 4), (3, 6)])
        arr = self.uid("ua")
        ctx["decls"].append("  logic [%d:0] %s [0:%d];" % (w - 1, arr, n - 1))
        b = ctx["body"]
        for i in range(n):
            b.append("  assign %s[%d] = %s;" % (arr, i, self.expr(w, ctx)))
        s = Sig(self.uid("s"), w)
        self.decl(ctx, s.name, w)
        b.append("  assign %s = %s[%s];" % (s.name, arr, self.idx(ctx, n)))
        return s

    def st_memory(self, ctx):
        if not ctx.get("clk"):
            return self.st_assign(ctx)
        d, w = self.pick([(16, 8), (8, 4), (4, 16), (32, 4)])
        mem = self.uid("mem")
        ctx["decls"].append("  logic [%d:0] %s [0:%d];" % (w - 1, mem, d - 1))
        b = ctx["body"]
        we = self.cond(ctx)
        wa, ra = self.idx(ctx, d), self.idx(ctx, d)
        b.append("  always_ff @(posedge %s)" % ctx["clk"])
        b.append("    if (%s) %s[%s] <= %s;" % (we, mem, wa, self.expr(w, ctx)))
        s = Sig(self.uid("s"), w)
        self.decl(ctx, s.name, w)
        b.append("  assign %s = %s[%s];" % (s.name, mem, ra))
        return s

    def st_struct(self, ctx):
        t = self.uid("pair_t")
        wa, wb = self.pick([2, 4, 8]), self.pick([1, 4, 8])
        ctx["decls"].append("  typedef struct packed { logic [%d:0] hi; logic [%d:0] lo; } %s;" % (wa - 1, wb - 1, t))
        v = self.uid("st")
        ctx["decls"].append("  %s %s;" % (t, v))
        b = ctx["body"]
        if self.chance(0.5):
            b.append("  assign %s = %s;" % (v, self.expr(wa + wb, ctx)))
        else:
            b.append("  assign %s.hi = %s;" % (v, self.expr(wa, ctx)))
            b.append("  assign %s.lo = %s;" % (v, self.expr(wb, ctx)))
        s = Sig(self.uid("s"), max(wa, wb))
        self.decl(ctx, s.name, s.width)
        b.append("  assign %s = %s.hi %s %s.lo;" % (s.name, v, self.pick(["+", "^", "-", "|"]), v))
        return s

    def st_comb_for(self, ctx):
        srcs = [x for x in ctx["sigs"] if x.width >= 4]
        if not srcs:
            return self.st_assign(ctx)
        a = self.pick(srcs)
        w = max(1, (a.width - 1).bit_length())
        s = Sig(self.uid("s"), w + 1)
        self.decl(ctx, s.name, w + 1)
        b = ctx["body"]
        i = self.uid("i")
        b.append("  always_comb begin")
        b.append("    %s = '0;" % s.name)
        b.append("    for (int %s = 0; %s < %d; %s++)" % (i, i, a.width, i))
        if self.f("func_break") and self.chance(0.5):
            b.append("      if (%s[%s]) begin %s = %d'(%s) + 1'b1; break; end" % (a.name, i, s.name, w + 1, i))
        else:
            b.append("      if (%s[%s]) %s = %d'(%s) + 1'b1;" % (a.name, i, s.name, w + 1, i))
        b.append("  end")
        return s

    def st_latch(self, ctx):
        s = self.new_sig(ctx)
        self.decl(ctx, s.name, s.width)
        b = ctx["body"]
        b.append("  always_latch")
        b.append("    if (%s) %s = %s;" % (self.cond(ctx), s.name, self.expr(s.width, ctx)))
        return s

    def st_function(self, ctx):
        fn = self.uid("f")
        w = self.pick([4, 8, 8, 16])
        nargs = self.pick([1, 2])
        args = ", ".join("input logic [%d:0] a%d" % (w - 1, i) for i in range(nargs))
        d = ctx["decls"]
        kind = self.pick(["popcount", "xorfold", "max", "rev"])
        d.append("  function automatic logic [%d:0] %s(%s);" % (w - 1, fn, args))
        if kind == "popcount":
            d.append("    logic [%d:0] n = '0;" % (w - 1))
            d.append("    for (int i = 0; i < %d; i++) begin" % w)
            if self.f("func_break") and self.chance(0.5):
                d.append("      if (!a0[i]) continue;")
                d.append("      n = n + 1'b1;")
            else:
                d.append("      n = n + {%d'b0, a0[i]};" % (w - 1))
            d.append("    end")
            d.append("    return n;")
        elif kind == "xorfold":
            d.append("    logic [%d:0] n = a0;" % (w - 1))
            d.append("    for (int i = 1; i < %d; i++) begin" % w)
            if self.f("func_break") and self.chance(0.5):
                d.append("      if (i == %d) break;" % (w // 2 + 1))
            d.append("      n = n ^ (a0 >> i);")
            d.append("    end")
            d.append("    return n%s;" % (" + a1" if nargs == 2 else ""))
        elif kind == "max":
            if nargs == 2:
                d.append("    return (a0 > a1) ? a0 : a1;")
            else:
                d.append("    return (a0 > %d'd%d) ? a0 : ~a0;" % (w, self.rng.randrange(1 << w)))
        else:
            d.append("    logic [%d:0] r;" % (w - 1))
            d.append("    for (int i = 0; i < %d; i++) r[i] = a0[%d - i];" % (w, w - 1))
            d.append("    return r%s;" % (" & a1" if nargs == 2 else ""))
        d.append("  endfunction")
        ctx.setdefault("funcs", []).append((fn, w, nargs))
        s = Sig(self.uid("s"), w)
        self.decl(ctx, s.name, w)
        ctx["body"].append("  assign %s = %s(%s);" % (s.name, fn, ", ".join(self.expr(w, ctx) for _ in range(nargs))))
        return s

    # ---------- modules ----------
    def package(self):
        if not self.f("package"):
            return
        lines = ["package fuzz_pkg;"]
        pv = self.pick([3, 5, 7])
        lines.append("  localparam int PKG_K = %d;" % pv)
        self.pkg_params.append(("PKG_K", pv))
        lines.append("  typedef logic [7:0] byte_t;")
        lines.append("  function automatic byte_t pkg_twist(input byte_t v);")
        lines.append("    return {v[3:0], v[7:4]} ^ byte_t'(PKG_K);")
        lines.append("  endfunction")
        lines.append("endpackage")
        self.pkg_funcs.append(("pkg_twist", 8))
        self.pkg_text = "\n".join(lines) + "\n"

    def module(self, name, level, maxlevel, parent_clk=True):
        """Generate module `name`; returns (ports, params, out widths)."""
        ctx = {"decls": [], "body": [], "sigs": [], "params": [], "name": name}
        is_top = (name == "top")
        ins = []
        has_clk = is_top or (parent_clk and self.chance(0.8))
        if has_clk:
            ctx["clk"] = "clk"
            ctx["rst"] = "btnC" if is_top else ("rst" if self.chance(0.8) else None)
        params = []
        if self.f("params") and self.chance(0.9 if not is_top else 0.5):
            for i in range(self.rng.randrange(1, 3)):
                pn = "P%s" % "NWKM"[i]
                pv = self.pick([2, 3, 4, 5, 6, 8, 8, 12, 16])
                params.append((pn, pv))
            ctx["params"] = list(params)
        if self.f("typedef") and self.chance(0.6):
            ctx["wordw"] = self.pick([4, 8, 16])
            ctx["wordt"] = self.uid("word_t")
        # ports
        if is_top:
            btns = ["btnC"] + (["btnU", "btnL", "btnR", "btnD"] if self.f("extra_buttons") else [])
            ins = [Sig("sw", 16)] + [Sig(b, 1) for b in btns]
            outs = [Sig("led", 16)]
            if self.f("seg_an_dp"):
                outs += [Sig("seg", 7), Sig("an", 4), Sig("dp", 1)]
        else:
            nin = self.rng.randrange(1, 4)
            ins = []
            for i in range(nin):
                w = self.pick([1, 4, 8, 16, 16])
                if params and self.chance(0.5):
                    pn, pv = self.pick(params)
                    w = pv
                ins.append(Sig("%s_in%d" % (name, i), w))
            nout = self.rng.randrange(1, 3)
            outs = [Sig("%s_out%d" % (name, i), self.pick([1, 4, 8, 16])) for i in range(nout)]
        ctx["sigs"] = [s for s in ins if s.name != "btnC" and s.name != "rst"] + ([Sig("btnC", 1)] if is_top and self.chance(0.3) else [])
        ctx["imp"] = bool(self.pkg_text) and self.chance(0.7)
        # submodules
        insts = []
        if level < maxlevel:
            nsub = self.rng.randrange(1, 3)
            for k in range(nsub):
                sub = "%s_m%d" % ("u" if is_top else name, k)
                sports, sparams, sins, souts = self.module(sub, level + 1, maxlevel, has_clk)
                reps = 2 if self.f("multi_inst") and self.chance(0.4) else 1
                for r in range(reps):
                    insts.append((sub, sports, sparams, sins, souts, r))
        # body: a few constructs before, between and after the instances
        for _ in range(self.rng.randrange(1, 4)):
            s = self.stmt(ctx)
            if s not in ctx["sigs"]:
                ctx["sigs"].append(s)
        for (sub, sports, sparams, sins, souts, r) in insts:
            self.instance(ctx, sub, sports, sparams, sins, souts, r)
        for _ in range(self.rng.randrange(1, 5)):
            s = self.stmt(ctx)
            if s not in ctx["sigs"]:
                ctx["sigs"].append(s)
        # drive the outputs
        for o in outs:
            ctx["body"].append("  assign %s = %s;" % (o.name, self.expr(o.width, ctx)))
        # text
        plist = ""
        if params:
            plist = " #(%s)" % ", ".join("parameter %s %s = %d" % (self.pick(["int", "", "logic [7:0]"]) if self.chance(0.4) else "", pn, pv) for pn, pv in params)
            plist = plist.replace("parameter  ", "parameter ")
        ports = []
        if has_clk:
            ports.append("input  logic clk")
            if ctx.get("rst") and not is_top:
                ports.append("input  logic rst")
        for s in ins:
            ports.append("input  logic %s%s" % ("[%s:0] " % self.wexpr(ctx, s.width) if s.width > 1 else "", s.name))
        for s in outs:
            ports.append("output logic %s%s" % ("[%s:0] " % self.wexpr(ctx, s.width) if s.width > 1 else "", s.name))
        imp = "  import fuzz_pkg::*;\n" if ctx["imp"] else ""
        text = "module %s%s (\n  %s\n);\n%s" % (name, plist, ",\n  ".join(ports), imp)
        if self.f("params") and self.chance(0.5):
            lp = self.uid("LP")
            lv = self.pick([3, 7, 9, 15])
            ctx["decls"].insert(0, "  localparam %s = %d;" % (lp, lv))
            ctx["body"].append("  // %s is %d" % (lp, lv))
        if ctx.get("wordt"):
            ctx["decls"].insert(0, "  typedef logic [%d:0] %s;" % (ctx["wordw"] - 1, ctx["wordt"]))
        text += "\n".join(ctx["decls"]) + "\n" + "\n".join(ctx["body"]) + "\nendmodule\n"
        port_names = ([ "clk" ] if has_clk else []) + (["rst"] if has_clk and ctx.get("rst") and not is_top else []) + [s.name for s in ins] + [s.name for s in outs]
        self.modules.append((name, text))
        return port_names, params, ins, outs

    def instance(self, ctx, sub, sports, sparams, sins, souts, r):
        """Instantiate `sub` in ctx: wires for its outputs, expressions for its inputs."""
        b = ctx["body"]
        iname = "%s_i%d" % (sub, r)
        conns = []
        star = self.f("star_conn") and self.chance(0.5) and r == 0
        inputs_expr = {}
        for s in sins:
            if star:
                self.decl(ctx, s.name, s.width)
                b.append("  assign %s = %s;" % (s.name, self.expr(s.width, ctx)))
                inputs_expr[s.name] = s.name
            else:
                if self.chance(0.5) and ctx["sigs"]:
                    src = self.pick(ctx["sigs"])
                    inputs_expr[s.name] = self.sized(src, s.width, ctx) if not (self.f("implicit_width") and self.chance(0.3)) else src.name
                else:
                    w = self.uid("w")
                    self.decl(ctx, w, s.width)
                    b.append("  assign %s = %s;" % (w, self.expr(s.width, ctx)))
                    inputs_expr[s.name] = w
        outw = {}
        for s in souts:
            if star:
                nm = s.name
            else:
                nm = "%s_%s" % (iname, s.name)
            self.decl(ctx, nm, s.width)
            outw[s.name] = nm
            ctx["sigs"].append(Sig(nm, s.width))
        ov = ""
        if sparams and self.f("param_override") and self.chance(0.7):
            pn, pv = self.pick(sparams)
            # keep the overridden value within the sizes the module's ports and arrays were made for
            bigger = [v for v in [2, 3, 4, 5, 6, 8, 12, 16] if v > pv]
            if bigger:
                ov = " #(.%s(%d))" % (pn, self.pick(bigger))
        for p in sports:
            if p == "clk":
                conns.append(("clk", ctx["clk"]))
            elif p == "rst":
                conns.append(("rst", ctx["rst"] or "1'b0"))
            elif p in inputs_expr:
                conns.append((p, inputs_expr[p]))
            else:
                conns.append((p, outw[p]))
        if star:
            if "rst" in sports and ctx.get("rst") != "rst":
                b.append("  %s%s %s (.rst(%s), .*);" % (sub, ov, iname, ctx["rst"] or "1'b0"))
            else:
                b.append("  %s%s %s (.*);" % (sub, ov, iname))
        elif self.f("named_conn"):
            b.append("  %s%s %s (%s);" % (sub, ov, iname, ", ".join(".%s(%s)" % c for c in conns)))
        else:
            b.append("  %s%s %s (%s);" % (sub, ov, iname, ", ".join(c[1] for c in conns)))

    # ---------- whole design ----------
    def build(self):
        self.package()
        if self.f("deep"):
            maxlevel = self.pick([3, 4])
        else:
            maxlevel = self.pick([1, 2, 2])
        self.module("top", 1, maxlevel)
        # files
        own = self.f("sub_own_file")
        top_text = ""
        for name, text in self.modules:
            if name == "top":
                top_text += text
            elif own and self.chance(0.8):
                self.files[name + ".sv"] = text
            else:
                top_text = text + "\n" + top_text
        if self.pkg_text:
            if self.f("package_own_file"):
                self.files["fuzz_pkg.sv"] = self.pkg_text
                # the product reads only files that hold a module: a package file is brought in with `include
                # (its documented fix; without it the build stops with package-file-not-given, probe 23c)
                if self.chance(0.9):
                    top_text = '`include "fuzz_pkg.sv"\n' + top_text
            else:
                top_text = self.pkg_text + "\n" + top_text
        self.files["top.sv"] = top_text
        # XDC: the master's lines for the ports top has
        m = re.search(r"module top.*?\);", top_text, re.S)
        ports = re.findall(r"(?:input|output)\s+logic\s+(?:\[[^\]]*\]\s*)?(\w+)", m.group(0))
        xdc = ["## generated by test/fuzz/gen.py seed %d" % self.seed]
        for p in ports:
            xdc += XDC[p]
        self.files["top.xdc"] = "\n".join(xdc) + "\n"
        self.files["top_tb.sv"] = self.testbench(ports)
        self.files["features.txt"] = "".join("%s=%d\n" % (n, int(self.F[n])) for n in NAMES) + "levels=%d\n" % maxlevel

    def testbench(self, ports):
        rng = random.Random(self.seed * 7919 + 1)
        ins = [p for p in ports if p in ("sw", "btnC", "btnU", "btnL", "btnR", "btnD")]
        outs = [p for p in ports if p in ("led", "seg", "an", "dp")]
        cycles = 300
        t = ["module tb;", "  logic clk = 1'b0;"]
        for p in ins:
            t.append("  logic %s%s = '0;" % ("[15:0] " if p == "sw" else "", p))
        for p in outs:
            w = {"led": 16, "seg": 7, "an": 4, "dp": 1}[p]
            t.append("  logic %s%s;" % ("[%d:0] " % (w - 1) if w > 1 else "", p))
        t.append("  top dut (%s);" % ", ".join(".%s(%s)" % (p, p) for p in ports))
        t.append("  always #5 clk = ~clk;")
        t.append("  initial begin")
        t.append("    $display(\"cycle %s\");" % " ".join(outs))
        for c in range(cycles):
            sets = []
            for p in ins:
                if p == "sw":
                    mode = rng.random()
                    if mode < 0.1: v = 0
                    elif mode < 0.2: v = 0xFFFF
                    else: v = rng.randrange(1 << 16)
                    sets.append("sw = 16'h%04x;" % v)
                elif p == "btnC":
                    v = 1 if c < 2 else (1 if rng.random() < 0.05 else 0)
                    sets.append("btnC = 1'b%d;" % v)
                else:
                    sets.append("%s = 1'b%d;" % (p, 1 if rng.random() < 0.3 else 0))
            t.append("    @(negedge clk); %s #1 $display(\"%d %s\", %s);" % (" ".join(sets), c, " ".join("%b" for _ in outs), ", ".join(outs)))
        t.append("    $finish;")
        t.append("  end")
        t.append("endmodule")
        return "\n".join(t) + "\n"


def main():
    args = sys.argv[1:]
    if "--list" in args:
        print("\n".join(NAMES))
        return
    if len(args) < 2:
        print(__doc__)
        sys.exit(2)
    seed, out = int(args[0]), args[1]
    on, off = [], []
    i = 2
    while i < len(args):
        if args[i] == "--on":
            on += args[i + 1].split(","); i += 2
        elif args[i] == "--off":
            off += args[i + 1].split(","); i += 2
        else:
            sys.exit("unknown argument %s" % args[i])
    for n in on + off:
        if n not in NAMES:
            sys.exit("no feature named %s (--list)" % n)
    g = Gen(seed, on, off)
    g.build()
    import os
    os.makedirs(out, exist_ok=True)
    for name, text in g.files.items():
        with open(os.path.join(out, name), "w") as fh:
            fh.write(text)


if __name__ == "__main__":
    main()
