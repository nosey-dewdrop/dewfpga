#!/usr/bin/env python3
"""Compare the design's ports with the XDC; fail with a readable message BEFORE place-and-route.
Usage: check_xdc.py <top.json> <top.xdc>
       check_xdc.py --fix-ports <file.sv>...   (before the tools run: the two lines Vivado accepts and yosys refuses
                                                are written into the student's file, and each changed line is printed)"""
import json, os, re, sys

SITE = "https://nosey-dewdrop.github.io/dewfpga/errors/"

def msg(kind, code, text, fix="", loc=""):
    """Every message the product prints, in one format: `<file>:<line>: <kind> [<code>]: <text> Fix: <fix> <page>`.
    kind is ERROR, warning or note; code is the page's folder under site/errors/ (a kebab-case slug); loc is the
    student's file:line when the problem is in the student's code, else the line starts with the kind; fix is one
    sentence the student can act on (a note that only reports what was done has none)."""
    return (loc + ": " if loc else "") + f"{kind} [{code}]: {text}" + (f" Fix: {fix}" if fix else "") + f" {SITE}{code}/"

_MODULE = re.compile(r"\bmodule\s+([A-Za-z_]\w*)(.*?)\bendmodule\b", re.S)
_ITEM_START = re.compile(r"(?:^|;|\)|\b(?:begin|end|else|generate|endgenerate)\b|\b(?:begin|end)\s*:\s*[A-Za-z_]\w*|`\w+[^\n]*\n)\s*$")

def _instances(other, body):
    """Where module `other` is instantiated in a module body (comments and strings blanked): `inv u_inv (`,
    `inv #(.N(4)) u_inv (`, an instance array `inv u_inv [3:0] (`, and the unnamed `inv (`. group(1) is the
    parameter block, group(2) the instance name (None when there is none). Not `$display(` next to a module
    named display. An instantiation is a module item, so an unnamed one has to start after `;`, `begin`,
    `end`, `)` (a generate if/for, an (* attribute *)), `else`, `generate`, a `begin : label` or a
    preprocessor line; a function that carries a module's name (IEEE 1800-2017 3.13: the two name spaces do
    not clash) is declared after its return type (`function logic [3:0] inv(`) and called after `=`, `(`,
    `,` or an operator (`= inv(sw)`), and nothing inside a function or task is an instance, so their bodies
    are blanked for this search (offsets kept)."""
    ibody = re.sub(r"\b(function|task)\b.*?\bend\1\b", lambda t: re.sub(r"[^\n]", " ", t.group(0)), body, flags=re.S)
    for m in re.finditer(r"(?<![\w.$])" + re.escape(other) + r"\b(\s*#\s*\([^;]*?\))?\s*([A-Za-z_]\w*)?\s*(\[[^\]]*\]\s*)?\(", ibody):
        if not m.group(2) and not _ITEM_START.search(ibody[:m.start()]): continue
        yield m

def _port_list(head):
    """(start, end) of the text inside the port list's parentheses of a module head (the text up to the first
    `;`), or None. The port list is the last (...) of the head: a #(...) parameter block comes before it."""
    end = head.rstrip().rfind(")")
    if end < 0 or head[end + 1:].strip(): return None
    depth = 0
    for i in range(end, -1, -1):
        if head[i] == ")": depth += 1
        elif head[i] == "(":
            depth -= 1
            if depth == 0: return i + 1, end
    return None

def fix_source(files):
    """Two things every CS223 lab may carry, that Vivado accepts and the standard and yosys refuse, are written
    into the student's file, and each changed line is printed as a note (nothing else in the file changes: comments,
    strings and the testbench stay, a CRLF file keeps its CRLF):
      - the course's SevenSegmentDisplay.sv declares `output [6:0] seg, logic dp,`: per the standard dp inherits
        `output` from the previous port. Vivado and Icarus accept that, yosys does not ("Module port `dp' is
        neither input nor output"), and a range-only item (`output logic [6:0] seg, [3:0] an`) written in an
        always block is a net to Icarus ("not a valid l-value"). The direction (and type) is written in.
      - an instance without a name (`inv(sw[0], led[0]);`): Vivado builds it, yosys and Icarus stop. A name is
        written in: u_<module>, then u_<module>_2 ... when that name is already in the file. A testbench (a
        module without ports) is left alone: yosys never reads it.
    The text is searched with comments and string literals blanked out (same length, same offsets), so a comment
    in the port list (one with a `;` in it) or a module name inside a $display string is not code."""
    # an item that starts with a type (`logic dp`) or with a range (`[3:0] an`) and no direction of its own
    item = re.compile(r"(,\s*)((?:(?:logic|wire|reg|bit)\b\s*(?:\[[^\]]*\]\s*)?|\[[^\]]*\]\s*)[A-Za-z_]\w*)")
    srcs, views = {}, {}
    for f in files:
        try: srcs[f] = open(f, encoding="utf-8", errors="surrogateescape", newline="").read()   # CRLF kept as is
        except OSError: continue
        views[f] = _blank(srcs[f])
    modules = set()
    for v in views.values(): modules.update(m.group(1) for m in _MODULE.finditer(v))
    for f, src in srcs.items():
        view = views[f]; edits = {}          # offset into src -> (text to insert there, what the note says)
        for m in _MODULE.finditer(view):
            name, body, off = m.group(1), m.group(2), m.start(2)
            head = body.split(";", 1)[0]
            pl = _port_list(head)
            if not pl or not head[pl[0]:pl[1]].strip(): continue      # no ports: a testbench
            plist = head[pl[0]:pl[1]]
            for mm in item.finditer(plist):
                # the direction (and type) in force is the last input/output/inout before this item
                dirs = list(re.finditer(r"\b(input|output|inout)\b(\s*(logic|wire|reg|bit)\b)?", plist[:mm.start()]))
                if not dirs: continue
                d = dirs[-1]; typ = (d.group(3) + " ") if d.group(3) and mm.group(2).startswith("[") else ""
                edits[off + pl[0] + mm.start(2)] = (d.group(1) + " " + typ, ("port-neither-input-nor-output", "wrote the port direction in"))
            for other in modules:
                if other == name: continue
                # `inv (`, `inv #(.N(4)) (`: an instance with no name between the module name and the port list
                for im in _instances(other, body):
                    if im.group(2): continue
                    n, new = 1, "u_" + other
                    while re.search(r"(?<![\w$])" + re.escape(new) + r"\b", view) or new in (e[0].strip() for e in edits.values()):
                        n += 1; new = f"u_{other}_{n}"
                    edits[off + (im.end(1) if im.group(1) else im.start() + len(other))] = (" " + new, ("unnamed-instance", "named the instance"))
        if not edits: continue
        text, notes = src, {}
        for at in sorted(edits, reverse=True):
            text = text[:at] + edits[at][0] + text[at:]
            notes[src.count("\n", 0, at) + 1] = edits[at][1]
        open(f, "w", encoding="utf-8", errors="surrogateescape", newline="").write(text)
        for i, (a, b) in enumerate(zip(src.splitlines(), text.splitlines()), 1):
            if a != b:
                code, what = notes.get(i, ("unnamed-instance", "changed"))
                print(msg("note", code, f"{what}:  {b.strip()}   (the standard and Yosys need it; Vivado accepts both)", loc=f"{f}:{i}"))
    return 0

def _blank(src):
    """Comments and the text of string literals blanked out (the quotes stay), every newline kept, so offsets
    and line numbers still map to the file: a `;` in a comment is not a statement's end, and a module name
    inside a $display string is not an instance."""
    def blank(m):
        t = m.group(0)
        if t[0] == '"': return '"' + re.sub(r"[^\n]", " ", t[1:-1]) + '"'
        return re.sub(r"[^\n]", " ", t)
    return re.sub(r'"(?:[^"\\\n]|\\.)*"|/\*.*?\*/|//[^\n]*', blank, src, flags=re.S)

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
                   if is_reg else f"write  assign {name} = {expr};  and declare {name} without the = part.")
            problems.append(msg("ERROR", "decl-init-reads-signal",
                                f"`{name} = {expr}` in a declaration is a start value, not a wire: it reads {', '.join(reads)} once, "
                                f"at time 0 (IEEE 1800-2017 6.8; yosys makes it the power-up value, so the board never follows {reads[0]}).",
                                fix, loc=f"{f}:{line}"))
    return problems

_WORD = re.compile(r"[A-Za-z_]\w*")
_CASE_LIT = re.compile(r"^(?:(\d[\d_]*)\s*)?'\s*[sS]?([bBoOdDhH])\s*([0-9a-fA-F_xXzZ?]+)$|^(\d[\d_]*)$")

def _skip_ws(t, i):
    while i < len(t) and t[i].isspace(): i += 1
    return i

def _skip_to(t, i, stop):
    """Index after the first `stop` character at bracket depth 0 from t[i] (len(t) when there is none)."""
    depth = 0
    while i < len(t):
        c = t[i]
        if c in "([{": depth += 1
        elif c in ")]}": depth -= 1
        if c == stop and depth <= 0: return i + 1
        i += 1
    return i

def _skip_endcase(t, i):
    """t[i:] starts at a case/casez/casex keyword (after its unique/priority): index after its endcase."""
    depth = 0
    for m in re.finditer(r"\b(case[zx]?|endcase)\b", t[i:]):
        depth += -1 if m.group(1) == "endcase" else 1
        if depth == 0: return i + m.end()
    return len(t)

def _skip_stmt(t, i):
    """Index after the statement at t[i] (a case item's body): `begin ... end [: name]`, if/else, a loop, a
    nested case, else up to the `;` at bracket depth 0."""
    i = _skip_ws(t, i)
    w = _WORD.match(t, i)
    kw = w.group(0) if w else ""
    if kw in ("unique", "unique0", "priority"):
        j = _skip_ws(t, w.end()); w = _WORD.match(t, j); kw = w.group(0) if w else ""; i = j
    if kw == "begin":
        depth = 0
        for m in re.finditer(r"\b(begin|end)\b", t[i:]):
            depth += 1 if m.group(1) == "begin" else -1
            if depth == 0:
                j = _skip_ws(t, i + m.end())
                if t.startswith(":", j):              # end : name
                    w2 = _WORD.match(t, _skip_ws(t, j + 1))
                    return w2.end() if w2 else j + 1
                return i + m.end()
        return len(t)
    if kw in ("case", "casez", "casex"): return _skip_endcase(t, i)
    if kw in ("if", "for", "while", "repeat", "foreach"):
        j = _skip_ws(t, w.end())
        j = _skip_to(t, j, ")") if t.startswith("(", j) else j
        j = _skip_stmt(t, j)
        if kw == "if":
            k = _skip_ws(t, j)
            if re.match(r"else\b", t[k:]): j = _skip_stmt(t, k + 4)
        return j
    if kw == "forever": return _skip_stmt(t, w.end())
    if kw == "do": return _skip_to(t, _skip_stmt(t, w.end()), ";")
    return _skip_to(t, i, ";")

def _case_items(t, i):
    """The labels of the case statement at t[i] (its unique/priority already read; t[i:] starts at case,
    casez or casex), as [(text as written, offset, item index)]: the labels of one item (`4'b10??, 4'b??11:
    led = 1;` is one case_item with one statement, IEEE 1800-2017 12.5) share an index. None when the
    statement is not one this scanner follows (a `case (x) inside`, `matches`, or text it cannot split)."""
    w = _WORD.match(t, i)
    j = _skip_ws(t, w.end())
    if not t.startswith("(", j): return None
    j = _skip_to(t, j, ")")
    k = _skip_ws(t, j)
    if re.match(r"(inside|matches)\b", t[k:]): return None
    end = _skip_endcase(t, i) - len("endcase")
    labels, pos, item = [], j, 0
    while True:
        pos = _skip_ws(t, pos)
        if pos >= end: break
        if re.match(r"default\b", t[pos:]):
            pos = _skip_ws(t, pos + len("default"))
            if t.startswith(":", pos): pos += 1
        else:
            q = pos; depth = 0
            while q < end:
                c = t[q]
                if c in "([{": depth += 1
                elif c in ")]}": depth -= 1
                elif c == ":" and depth == 0 and t[q + 1:q + 2] != ":" and t[q - 1] != ":": break
                q += 1
            if q >= end: return None
            at = pos
            for piece in t[pos:q].split(","):
                s = piece.strip()
                labels.append((s, at + piece.index(s) if s else at, item))
                at += len(piece) + 1
            item += 1
            pos = q + 1
        nxt = _skip_stmt(t, pos)
        if nxt <= pos or nxt > end: return None
        pos = nxt
    return labels

def _case_literal(label, kind):
    """A case item label that is an integer literal, as (fixed bit mask, value, width), else None. For casez
    a ? or z digit is a wildcard, for casex x, z and ? are; a wildcard digit elsewhere (an x in casez, any
    in a plain case) is a value no synthesized input takes, so it is not a literal here (None: no guess).
    An unsized literal is 32 bits; a shorter literal is extended with its leftmost digit when that is a
    wildcard, else with 0 (IEEE 1800-2017 5.7.1)."""
    m = _CASE_LIT.match(label)
    if not m: return None
    if m.group(4): width, base, digits = 32, "d", m.group(4).replace("_", "")
    else:
        width = int(m.group(1).replace("_", "")) if m.group(1) else 32
        base, digits = m.group(2).lower(), m.group(3).replace("_", "")
    if width == 0 or not digits: return None
    if base == "d":
        if not digits.isdigit(): return None
        return (1 << width) - 1, int(digits) & ((1 << width) - 1), width
    wild = {"casez": "z?", "casex": "xz?", "case": ""}[kind]
    per = {"b": 1, "o": 3, "h": 4}[base]
    bits = []                                       # msb first: (fixed, value)
    for ch in digits:
        c = ch.lower()
        if c in "xz?":
            if c not in wild: return None
            bits += [(0, 0)] * per
        else:
            d = int(c, 16)
            if d >= 1 << per: return None
            bits += [(1, (d >> k) & 1) for k in range(per - 1, -1, -1)]
    if len(bits) < width: bits = [bits[0] if bits[0][0] == 0 else (1, 0)] * (width - len(bits)) + bits
    fixed = value = 0
    for fx, v in bits[-width:]: fixed, value = fixed << 1 | fx, value << 1 | v
    return fixed, value, width

def _localparam_literals(body):
    """name -> the integer literal text of every `localparam ... NAME = <literal>` of the module body, with
    `localparam logic [3:0] HI = 4'b10zz, LO = 4'bzz11;` giving both. A localparam cannot be overridden at
    an instance (IEEE 1800-2017 6.20.4), so its value is the text on its line; a `parameter` can be
    (#(.W(8)) or defparam), so it is not followed. One whose value is an expression (HI | 4'b0011, W-1,
    $clog2(N)) is not followed either: no guess."""
    out = {}
    for m in re.finditer(r"\blocalparam\b", body):
        decl = body[m.end():_skip_to(body, m.end(), ";")]
        for a in re.finditer(r"\b([A-Za-z_]\w*)\s*=\s*([^,;=]+)", decl):
            v = a.group(2).strip()
            if _CASE_LIT.match(v): out[a.group(1)] = v
    return out

def _unique_case_problems(f, body, bline):
    """A unique case / casez / casex two of whose items can match at once (`4'b10??` and `4'b??11` both match
    1011): IEEE 1800-2017 12.5.3 says unique asserts that no two items match, so the design is wrong, and the
    two tools disagree silently: iverilog ignores unique and takes the first item, yosys (and Vivado, UG901
    Ch.10: unique case is parallel_case) build the items in parallel and OR their values, so the board does
    not do what the simulation showed. Only statements whose every label is an integer literal, or a
    localparam of this module whose value is one (_localparam_literals), are checked; one with an enum
    name, a `parameter` (an instance may override it), an expression, a range or `inside` is skipped: no
    guess. Two labels of one item (`4'b10??, 4'b??11: led = 1;`) are one item with one statement (IEEE
    1800-2017 12.5), so they may overlap: there is no second value to OR, and the netlist equals the RTL.
    The first overlapping pair of a statement is reported once, at the second item's line; a localparam
    item is named with its value (`HI = 4'b10zz`) so the overlapping bits are on the line."""
    problems = []
    consts = _localparam_literals(body)
    for m in re.finditer(r"\b(unique0?)\s+(case[zx]?)\b", body):
        q, kind = m.group(1), m.group(2)
        labels = _case_items(body, m.start(2))
        if not labels: continue
        lits = [(_case_literal(consts.get(s, s), kind), s if s not in consts else f"{s} = {consts[s]}", off, item)
                for s, off, item in labels]
        if any(l[0] is None for l in lits): continue
        found = None
        for j in range(1, len(lits)):
            for i in range(j):
                if lits[i][3] == lits[j][3]: continue           # two labels of the same item
                (fa, va, wa), (fb, vb, wb) = lits[i][0], lits[j][0]
                w = max(wa, wb); full = (1 << w) - 1
                fa |= full & ~((1 << wa) - 1); fb |= full & ~((1 << wb) - 1)      # the shorter one: 0 above its width
                if (fa & fb) & (va ^ vb): continue
                found = (i, j, w, va | vb, fa, va, fb, vb); break
            if found: break
        if not found: continue
        i, j, w, both, fa, va, fb, vb = found
        (_, sa, oa, _), (_, sb, ob, _) = lits[i], lits[j]
        la, lb = (bline + body.count("\n", 0, o) for o in (oa, ob))
        # the second item with its wildcard at the first item's highest fixed bit set to the other value
        # (4'b??11 next to 4'b10??: 4'b0?11), or the first item's when only it has such a bit
        def respell(fx, v, other_fx, other_v):
            for k in range(w - 1, -1, -1):
                if other_fx >> k & 1 and not fx >> k & 1:
                    return f"{w}'b" + "".join(str(1 - (other_v >> b & 1)) if b == k else (str(v >> b & 1) if fx >> b & 1 else "?") for b in range(w - 1, -1, -1))
            return None
        # a localparam item is respelled under its name (LO = 4'b0?11): the student edits the localparam's line
        na, nb = (s.split(" = ")[0] + " = " if " = " in s else "" for s in (sa, sb))
        disjoint = respell(fb, vb, fa, va)
        how = (f"make the items disjoint ({sa} and {nb}{disjoint})" if disjoint else
               (f"make the items disjoint ({na}{respell(fa, va, fb, vb)} and {sb})" if respell(fa, va, fb, vb) else
                "remove one of the two items (they are the same value)"))
        problems.append(msg("ERROR", "unique-case-overlap",
                            f"the items {sa} ({f}:{la}) and {sb} ({f}:{lb}) of this {q} {kind} both match {w}'b{both:0{w}b}, and {q} promises "
                            f"that only one item can match: the simulation takes the first item (iverilog ignores {q}), and the hardware, "
                            f"built as parallel logic the way Vivado builds a {q} case (UG901 Ch.10, parallel_case), ORs the two items' "
                            f"values, so the board would not do what the simulation showed.",
                            f"{how}, write priority {kind} when the first match should win, or drop {q}.", loc=f"{f}:{lb}"))
    return problems

def _parse(files, sim=()):
    """Every module in the files: mods (name -> dict(file, tb, body, line)), their order, what each instantiates
    (inst: module -> set of modules), and the problems seen on the way. scan() and list_tops() share this; there
    is no second discovery logic. Files in sim (a Vivado simulation set) are simulation-only: their modules may
    call $finish and are never the top; they still compile into the simulation."""
    sim = set(sim)
    mods = {}                       # name -> dict(file, tb, body, line)
    order = []
    problems = []
    for f in files:
        try: raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        src = _blank(raw)               # comments and string texts blanked, same offsets
        typedefs = [n for _, _, n in _typedefs(src)]
        synth = _synth_view(src)        # same length as src: a module's span is the same in both
        for m in re.finditer(r"\bmodule\s+([A-Za-z_]\w*)(.*?)\bendmodule\b", src, re.S):
            name, body = m.group(1), m.group(2)
            line = src.count("\n", 0, m.start()) + 1
            if name in mods:            # a backup next to the file (lab4_old.sv): the last one read would win silently
                d = mods[name]
                (f1, l1), (f2, l2) = sorted([(d['file'], d['line']), (f, line)])     # the same order on every machine
                problems.append(msg("ERROR", "module-defined-twice", f"module {name} is defined twice: {f1}:{l1} and {f2}:{l2}; the last one read would win silently.",
                                    "keep one, or move the backup out of this folder.", loc=f"{f1}:{l1}"))
                continue
            head = body.split(";", 1)[0]
            ports = re.search(r"\)\s*$", head) and re.sub(r"#\s*\(.*?\)", "", head, flags=re.S)
            has_ports = bool(ports and re.search(r"\(\s*[^\s)]", ports))
            bline = src.count("\n", 0, m.start(2)) + 1
            mods[name] = dict(file=f, tb=not has_ports, body=body, line=line, off=m.start(), sim=f in sim)
            order.append(name)
            if has_ports and f not in sim:
                # what synthesis sees: a check under `ifndef SYNTHESIS is simulation-only and is fine
                sbody = synth[m.start(2):m.end(2)]
                for fm in re.finditer(r"\$(finish|stop)\b", sbody):
                    fl = bline + sbody.count("\n", 0, fm.start())
                    problems.append(msg("ERROR", "finish-in-design", f"${fm.group(1)} in a design module ({name}): Vivado ignores it (UG901 Table 21: $finish Ignored) and yosys stops on it.",
                                        "remove it, move the check to the testbench, or wrap it in `ifndef SYNTHESIS ... `endif.", loc=f"{f}:{fl}"))
                problems += _decl_init_problems(f, sbody, bline, typedefs)
                problems += _unique_case_problems(f, sbody, bline)
    names = set(mods)
    inst = {}                       # module -> set of modules it instantiates
    for f in files:
        try: raw = open(f, encoding="utf-8", errors="replace").read()
        except OSError: continue
        # only the header Vivado writes on a funcsim netlist (write_verilog -mode funcsim, under .sim/ and .runs/)
        # names the file a leftover: its cells (IBUF, OBUF, the clock buffers) are the pins' own, and it is not the
        # student's design. The course's "ready modules" come in netlist form too ((* keep_hierarchy *), \<const0>,
        # GND, LUT2 ...) with no such header, and yosys reads and builds them (probe 57), so they pass.
        head = raw[:2000]
        hm = re.search(r"NotValidForBitStream|write_verilog -mode funcsim|This verilog netlist is a functional simulation", head)
        if hm:
            problems.append(msg("ERROR", "vivado-netlist-in-folder", f"{f} is a netlist Vivado wrote after synthesis, not source code (its header says so, and Yosys cannot read it); Vivado writes these under .sim/ and .runs/.",
                                "delete it from this folder and keep your own .sv files.", loc=f"{f}:{head.count(chr(10), 0, hm.start()) + 1}"))
    for n, d in mods.items():
        inst[n] = set()
        for other in names:
            if other == n: continue
            # every instance of `other` (see _instances). An instance without a name is named by --fix-ports
            # before this scan runs; one that is still here is reported.
            for m in _instances(other, d["body"]):
                inst[n].add(other)
                if not m.group(2) and not d["tb"]:
                    line = d["line"] + d["body"].count("\n", 0, m.start())
                    problems.append(msg("ERROR", "unnamed-instance", f"`{other}(` is an instance without a name: Vivado lets that pass; the standard and Yosys do not.",
                                        f"write  {other} u_{other}(", loc=f"{d['file']}:{line}"))
    return mods, order, inst, problems

def _roots(mods, order, inst):
    design = [n for n in order if not mods[n]["tb"]]
    used = set().union(*(inst[n] for n in design)) if design else set()
    return design, [n for n in design if n not in used and not mods[n]["sim"]]

def list_tops(files, project_top=None):
    """`dewfpga tops`: one candidate per line, `<module>\t<file>`: the design modules nothing instantiates
    (testbenches excluded), the Vivado project's top first when it is one of them. No lines when there is none;
    the problems scan() would stop on are not this command's business, so nothing is printed about them."""
    mods, order, inst, _ = _parse(files)
    _, roots = _roots(mods, order, inst)
    if project_top in roots: roots = [project_top] + [n for n in roots if n != project_top]
    for n in roots: print(f"{n}\t{mods[n]['file']}")
    return 0

def scan(files, want=None, xdc_names=(), cmd="bit", sim=()):
    """Which file holds the top module, which files are testbenches. Printed as KEY=value lines for the shell.
    A testbench is a module with no ports (or an empty port list); a module with ports is a design, even
    when it calls $finish (that is a PROBLEM: Vivado ignores $finish, UG901 Table 21, and yosys stops on it).
    The top is the design module that no other design module instantiates. File names are free: lab5.sv may
    hold `module top_design`. When two modules could be the top and nothing names one, the scanner stops and
    names both, unless exactly one is named like a .xdc in the folder: then WHY= says so, and the CLI prints it."""
    mods, order, inst, problems = _parse(files, sim)
    for pr in problems: print("PROBLEM=" + pr)
    if problems: return 1
    design, roots = _roots(mods, order, inst)
    top = None; why = ""
    where = lambda n: f"{mods[n]['file']}:{mods[n]['line']}"          # a module's declaration, the student's file:line
    listed = lambda ns: ", ".join(f"{n} ({where(n)})" for n in ns)
    def stop(code, text, fix, loc=""): print("ERROR=" + msg("ERROR", code, text, fix, loc)); return 1
    if want:
        base = re.sub(r"\.(sv|v|SV|V)$", "", want)
        if want in mods and not mods[want]["tb"]: top = want
        else:
            # by file: the name as given, or its base name (a Vivado project's files sit under <name>.srcs/...)
            infile = [n for n in design if re.sub(r"\.(sv|v|SV|V)$", "", mods[n]["file"]) == base
                      or re.sub(r"\.(sv|v|SV|V)$", "", os.path.basename(mods[n]["file"])) == base]
            if len(infile) == 1: top = infile[0]
            elif want in mods:
                return stop("top-is-a-testbench", f"{want} is a testbench (it has no ports), not a design.",
                            f"name a design module instead:  dewfpga {cmd} {design[0]}" + (f"  (the designs here: {', '.join(design)})." if len(design) > 1 else ".")
                            if design else "put the design (a module with ports) in a .sv file in this folder.", where(want))
            elif infile:
                inroots = [n for n in infile if n in roots]
                if len(inroots) == 1: top = inroots[0]
                else: return stop("two-tops", f"{len(infile)} modules in {want} could be the top: {listed(infile)}.",
                                  f"name the module:  dewfpga {cmd} {infile[0]}", where(infile[0]))
            else: return stop("no-such-module", f"no module named {want} in {' '.join(files)}" + (f"; the modules here: {', '.join(design)}." if design else "."),
                              f"name one of them, or the file that holds it:  dewfpga {cmd} {design[0]}" if design else "check the spelling, or start a design:  dewfpga new blink")
    elif len(roots) == 1: top = roots[0]
    elif not design: return stop("no-design-module", "no design module in " + " ".join(files) + (" (only testbenches)." if mods else "."),
                                 "a design is a module with ports; put it in a .sv file in this folder, or start one:  dewfpga new blink")
    else:
        # never by file name: the file is named after one module and the project's top is the other (corpus
        # Lab 4 folders). A .xdc named after one root is a choice the student made, and the CLI says it took it
        pref = [n for n in roots if n in xdc_names]
        if len(pref) == 1: top = pref[0]; why = "named by " + top + ".xdc"
        else: return stop("two-tops", f"{len(roots)} modules could be the top (nothing instantiates them): {listed(roots)}.",
                          f"name it:  dewfpga {cmd} {roots[0]}", where(roots[0]))
    tbs = [n for n in order if mods[n]["tb"]]
    tb_for = [n for n in tbs if top in inst[n]] or ([tbs[0]] if len(tbs) == 1 else [])
    print("TOP=" + top)
    print("WHY=" + why)
    print("TOPFILE=" + mods[top]["file"])
    print("DESIGN=" + " ".join(dict.fromkeys(mods[n]["file"] for n in design)))
    print("TB=" + (mods[tb_for[0]]["file"] if tb_for else ""))
    print("AUTO=" + ("1" if not want else "0"))
    return 0

def _vivado_files(src_dir, xdc_dir, sim_dir):
    """The three Vivado folders without an .xpr: every .sv/.v under sources_1 (imports/ and new/), .xdc under
    constrs_1, .sv/.v under sim_1; one order on every machine (byte order, as the CLI sorts)."""
    def under(d, exts):
        out = []
        for root, _, names in os.walk(d):
            out += [os.path.normpath(os.path.join(root, n)) for n in names if n.lower().endswith(exts)]
        return sorted(out)
    return under(src_dir, (".sv", ".v")), under(xdc_dir, (".xdc",)), under(sim_dir, (".sv", ".v"))

def vivado_project(xpr=None, srcs=None):
    """--xpr <file.xpr>: the enabled files of the project's active design, constraint and simulation sets, as the
    .xpr lists them (xml), root-relative (the CLI runs in the folder that holds the .xpr): $PSRCDIR is
    <name>.srcs, $PPRDIR is that folder. The sets are the ones Vivado builds with: synth_1's SrcSet and
    ConstrsSet, and the ActiveSimSet; without those, the only set of each Type (DesignSrcs, Constrs,
    SimulationSrcs). Two sets of a type and nothing saying which is active is a PROBLEM= (not a guess); for the
    simulation set it is SIMPROBLEM=, which stops sim only (the other commands never read that set). A file
    with <Attr Name="AutoDisabled" Val="1"/> or IsEnabled 0 is skipped, as Vivado skips it. Headers (.svh/.vh)
    are not sources; .sv/.v/.xdc are kept. A listed file that is not there, a path under a Vivado variable this
    reader does not know ($PCACHEDIR ...), or a name with a space is a PROBLEM= line with the .xpr line.
    --srcs <name>.srcs: the same three folders by glob when there is no .xpr. Prints one file per line
    (SRC=<path>, XDC=<path>, SIM=<path>, repeated; the CLI reads them line by line, so a space in a path is
    never split), then TOP= (design set TopModule) and SIMTOP= (simulation set TopModule)."""
    def emit(key, files):
        for f in files: print(key + "=" + f)
    escape = "or copy the .sv and .xdc files to a folder outside the project and run dewfpga there"
    if xpr is None:
        name = re.sub(r"\.srcs$", "", os.path.basename(srcs))
        src, xdc, sim = _vivado_files(os.path.join(srcs, "sources_1"), os.path.join(srcs, "constrs_1"), os.path.join(srcs, "sim_1"))
        bad = 0
        for kind, files in (("PROBLEM", src + xdc), ("SIMPROBLEM", sim)):
            for f in files:
                if re.search(r"\s", f):
                    print(kind + "=" + msg("ERROR", "file-name-with-space", f"'{f}': file names with spaces are not supported by the tools.",
                                           f"rename it (e.g. {'_'.join(f.split())}), {escape}."))
                    if kind == "PROBLEM": bad = 1
        if bad: return 1
        emit("SRC", src); emit("XDC", xdc); emit("SIM", sim); print("TOP="); print("SIMTOP=")
        return 0
    import xml.etree.ElementTree as ET
    raw = open(xpr, encoding="utf-8", errors="replace").read()
    try: tree = ET.fromstring(raw)
    except ET.ParseError as e:
        print("PROBLEM=" + msg("ERROR", "vivado-project-unreadable", f"{xpr} is not the XML Vivado writes ({e}).",
                               f"open the project in Vivado once and save it, {escape}.", loc=f"{xpr}:{getattr(e, 'position', (1,))[0]}"))
        return 1
    name = re.sub(r"\.xpr$", "", os.path.basename(xpr))
    def lineof(text):
        return raw[:raw.find(text)].count("\n") + 1 if text and text in raw else 1
    # which set of each type Vivado builds with (deterministic; never a guess between two)
    sets = {}                                   # (type, set name) -> FileSet element
    for fs in tree.iter("FileSet"):
        if fs.get("Type") in ("DesignSrcs", "Constrs", "SimulationSrcs"): sets[(fs.get("Type"), fs.get("Name", ""))] = fs
    want = {"DesignSrcs": "", "Constrs": "", "SimulationSrcs": ""}
    for r in tree.iter("Run"):
        if r.get("Id") == "synth_1":
            want["DesignSrcs"] = r.get("SrcSet", ""); want["Constrs"] = r.get("ConstrsSet", "")
    for o in tree.iter("Option"):
        if o.get("Name") == "ActiveSimSet": want["SimulationSrcs"] = o.get("Val", "")
    label = {"DesignSrcs": "design source", "Constrs": "constraint", "SimulationSrcs": "simulation"}
    how = {"DesignSrcs": "synth_1's SrcSet", "Constrs": "synth_1's ConstrsSet", "SimulationSrcs": "ActiveSimSet"}
    chosen = {}
    bad = 0
    for t in want:
        names = [n for (tt, n) in sets if tt == t]
        if want[t] and want[t] in names: chosen[t] = want[t]
        elif len(names) == 1 and not want[t]: chosen[t] = names[0]
        elif not names: chosen[t] = None
        else:
            # two simulation sets and no active one: only sim needs that set, so the CLI gets it as SIMPROBLEM= and
            # stops there for sim alone; bit, flash, clean and tops never read the simulation set (R2) and go on
            what = f"names {want[t]}, which is not a {label[t]} set" if want[t] else "does not say which one is active"
            key = "SIMPROBLEM" if t == "SimulationSrcs" else "PROBLEM"
            print(key + "=" + msg("ERROR", "vivado-set-ambiguous", f"{xpr} has {len(names)} {label[t]} sets ({', '.join(names)}) and {how[t]} {what}; dewfpga does not guess.",
                                  f"in Vivado make the set you build with active (Sources > right-click the set > Make Active) and save the project, {escape}.", loc=f"{xpr}:{lineof(want[t] and 'Name=' + chr(34) + want[t] + chr(34))}"))
            if key == "PROBLEM": bad = 1
            else: chosen[t] = None
    if bad: return 1
    out = {"DesignSrcs": [], "Constrs": [], "SimulationSrcs": []}
    tops = {"DesignSrcs": "", "SimulationSrcs": ""}
    def enabled(fe):
        for a in fe.iter("Attr"):
            if a.get("Name") == "AutoDisabled" and a.get("Val") == "1": return False
            if a.get("Name") == "IsEnabled" and a.get("Val") in ("0", "FALSE", "false"): return False
        return True
    for t, setname in chosen.items():
        if setname is None: continue
        fs = sets[(t, setname)]
        key = "SIMPROBLEM" if t == "SimulationSrcs" else "PROBLEM"
        for fe in fs.findall("File"):
            p = fe.get("Path", "")
            if not enabled(fe): continue
            ext = os.path.splitext(p)[1].lower()
            if t == "Constrs" and ext != ".xdc": continue
            if t != "Constrs" and ext not in (".sv", ".v"): continue
            rel = p.replace("$PSRCDIR", name + ".srcs").replace("$PPRDIR", ".")
            m = re.match(r"\$([A-Za-z_]\w*)", rel)
            if m:                           # $PCACHEDIR, $PIPUSERFILESDIR ...: a place only Vivado knows
                print(key + "=" + msg("ERROR", "vivado-path-unknown", f"{xpr} lists {p}, and dewfpga does not know where Vivado keeps ${m.group(1)} (it knows $PSRCDIR and $PPRDIR).",
                                       f"copy that file into {name}.srcs/sources_1/new and add it to the project from there (Sources > Add Sources), {escape}.", loc=f"{xpr}:{lineof(p)}"))
                if key == "PROBLEM": bad = 1
                continue
            rel = os.path.normpath(rel)
            if re.search(r"\s", rel):
                print(key + "=" + msg("ERROR", "file-name-with-space", f"{xpr} lists '{rel}', and file names with spaces are not supported by the tools.",
                                       f"rename it (e.g. {'_'.join(rel.split())}) in Vivado (Sources > right-click > Rename) and save the project, {escape}.", loc=f"{xpr}:{lineof(p)}"))
                if key == "PROBLEM": bad = 1
                continue
            if not os.path.isfile(rel):
                print(key + "=" + msg("ERROR", "vivado-file-missing", f"{xpr} lists {p} ({rel}), and that file is not there.",
                                       f"put the file back, or remove it from the project in Vivado (Sources > Remove File from Project), {escape}.", loc=f"{xpr}:{lineof(p)}"))
                if key == "PROBLEM": bad = 1
                continue
            if rel not in out[t]: out[t].append(rel)
        for o in fs.iter("Option"):
            if o.get("Name") == "TopModule" and t in tops: tops[t] = o.get("Val", "")
    if bad: return 1
    emit("SRC", out["DesignSrcs"]); emit("XDC", out["Constrs"]); emit("SIM", out["SimulationSrcs"])
    print("TOP=" + tops["DesignSrcs"]); print("SIMTOP=" + tops["SimulationSrcs"])
    return 0

if len(sys.argv) >= 3 and sys.argv[1] == "--xpr":
    sys.exit(vivado_project(xpr=sys.argv[2]))
if len(sys.argv) >= 3 and sys.argv[1] == "--srcs":
    sys.exit(vivado_project(srcs=sys.argv[2]))
if len(sys.argv) >= 2 and sys.argv[1] == "--list-tops":
    # --list-tops [--project-top NAME] files...
    args = sys.argv[2:]; pt = None
    if args and args[0] == "--project-top": pt = args[1] or None; args = args[2:]
    sys.exit(list_tops(args, pt))
if len(sys.argv) >= 2 and sys.argv[1] == "--fix-ports":
    sys.exit(fix_source(sys.argv[2:]))
if len(sys.argv) >= 2 and sys.argv[1] == "--scan":
    # --scan [--top NAME] [--xdc name,name] [--cmd sim|bit|flash|clean] [--sim a.sv,b.sv] files...
    # (--cmd: the command the fix names; --sim: the simulation set's files, simulation-only, never the top)
    args = sys.argv[2:]; want = None; xn = (); cmd = "bit"; simf = ()
    if args and args[0] == "--top": want = args[1]; args = args[2:]
    if args and args[0] == "--xdc": xn = tuple(args[1].split(",")); args = args[2:]
    if args and args[0] == "--cmd": cmd = args[1]; args = args[2:]
    if args and args[0] == "--sim": simf = tuple(x for x in args[1].split("\n") if x); args = args[2:]
    sys.exit(scan(args, want, xn, cmd, simf))
# --pins <package_pins.csv>: the chip's package pins (prjxray's artix7/xc7a35tcpg236-1/package_pins.csv, the
# database the bitstream is built from, so it is there whenever a bitstream can be built at all); without it, or
# when the file is not there, the pin names are not checked here and nextpnr's own line is what stops the build
pins_csv = None
if len(sys.argv) >= 4 and sys.argv[1] == "--pins":
    pins_csv = sys.argv[2]; del sys.argv[1:3]
if len(sys.argv) != 3:
    sys.exit("usage: check_xdc.py [--pins package_pins.csv] <json> <xdc>")

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

# every port's bits as the XDC names them (sw, or sw[0] sw[1] ...), and where the student declared it: yosys
# writes the declaration's file:line as the netname's src attribute (design.sv:2.30-2.32)
ports = set()
decl = {}                                   # port -> "design.sv:2"
form = {}                                   # port -> the shape this check does not read yet ("[0:0]" or "[4:1]")
nets = tmod.get("netnames", {})
for p, info in tmod.get("ports", {}).items():
    n = len(info.get("bits", []))
    at = nets.get(p, {}).get("attributes", {}).get("src", "")
    m = re.match(r"(.+?):(\d+)\.", at)
    if m: decl[p] = f"{m.group(1)}:{m.group(2)}"
    if n == 1:
        ports.add(p)
        # a vector of one bit ([N-1:0] with N = 1, IEEE 1800-2017 7.4): its pin in the XDC is sw[0], and yosys
        # marks the wire single_bit_vector; the names here are still built as a scalar (not read yet: #5)
        if nets.get(p, {}).get("attributes", {}).get("single_bit_vector"): form[p] = "[0:0]"
    else:
        ports.update(f"{p}[{i}]" for i in range(n))
        # bits numbered from elsewhere than 0 ([4:1]): yosys writes the offset, the names here still start at 0
        off = info.get("offset", 0)
        if off: form[p] = f"[{off + n - 1}:{off}]"
def where(p):
    """The student's file:line of a port's declaration (led[3] -> led's line), or '' when yosys did not say."""
    return decl.get(p.split("[")[0], "")

# 2) ports mentioned in the XDC, which properties each one got, and the line of each: a commented-out line still
# counts as the line that would give the port its pin (the fix names it). A get_ports form Vivado expands and
# this check does not read (a wildcard, a list of several ports, -regexp / -filter) is named as such.
xdc_ports = set()
has_pin, has_iostd = set(), set()
xline = {}                                  # port -> the XDC line that sets its PACKAGE_PIN (or names it)
cline = {}                                  # port -> a commented-out XDC line that names it
pin_of = {}                                 # port -> the PACKAGE_PIN name its line gives (W5)
forms = []                                  # (line, the get_ports text) this check does not read
for ln, raw in enumerate(open(xf, encoding="utf-8", errors="replace"), 1):
    code = raw.split("#")[0]
    pm = re.search(r"\bPACKAGE_PIN\s+([A-Za-z0-9_]+)", code)
    for m in re.finditer(r"get_ports\s*(-\w+\s+)*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", code):
        p = m.group(2)
        xdc_ports.add(p)
        if p not in xline or re.search(r"\bPACKAGE_PIN\b", code): xline[p] = ln
        if re.search(r"\bPACKAGE_PIN\b", code): has_pin.add(p)
        if pm: pin_of[p] = pm.group(1)
        if re.search(r"\bIOSTANDARD\b", code): has_iostd.add(p)
    for m in re.finditer(r"get_ports\s*(?:-\w+\s+)*(\{[^}]*\}|[^\s\]]+)", code):
        t = m.group(1).strip()
        inner = t.strip("{}").strip()
        if re.search(r"[*?]", inner) or re.search(r"\s", inner) or re.search(r"get_ports\s+-", m.group(0)):
            forms.append((ln, m.group(0).strip()))
    for m in re.finditer(r"get_ports\s*(?:-\w+\s+)*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", raw[len(code):]):
        cline.setdefault(m.group(1), ln)

def by_index(q):  # sw[2] before sw[10]
    m = re.match(r"(\w+)(?:\[(\d+)\])?$", q); return (m.group(1), int(m.group(2) or 0)) if m else (q, 0)
missing = sorted(ports - xdc_ports, key=by_index)   # in the code, not in the XDC
extra   = sorted(xdc_ports - ports, key=by_index)   # in the XDC, not in the code

for ln, t in forms:
    kind = "a wildcard" if re.search(r"[*?]", t) else ("an option (-regexp, -filter ...)" if re.search(r"get_ports\s+-", t) else "a list of several ports")
    print(msg("warning", "xdc-get-ports-form", f"`{t}` is {kind}: Vivado expands it, and this check does not read that form yet, so the ports it names count as unpinned here.",
              "write one line per port with its full name, as the course's Basys3_Master.xdc does:  set_property -dict { PACKAGE_PIN V17  IOSTANDARD LVCMOS33 } [get_ports {sw[0]}]",
              loc=f"{xf}:{ln}"))

xdc_base = {q.split("[")[0] for q in xdc_ports}
if missing:
    # three different mistakes: the port's shape is one this check does not read ([0:0], [4:1]); the name
    # exists in the XDC but not for these indices (the lines are still commented out); the name is not in the
    # XDC at all (the module uses a different name)
    xdc_lower = {q.lower(): q for q in xdc_ports}
    shown = 0
    for p in missing:
        b = p.split("[")[0]
        if b in form and form[b] == "[0:0]":
            text = (f"{p} is a vector of one bit ({b} {form[b]}), so its pin in the XDC is named {b}[0]" + (" (the XDC has that line)" if f"{b}[0]" in has_pin else "")
                    + "; this check reads a one-bit port as the scalar " + b + ", not " + b + "[0]: a [0:0] port is not read yet.")
            fix = f"declare it as a scalar ({b} without the range) and name it [get_ports {b}] in the XDC; a module written for any width cannot, and then this check is what stops you, not Vivado."
        elif b in form:
            text = (f"{p} is not a bit of {b}: {b} is declared {form[b]} (its bits and its XDC names start at {form[b].split(':')[1].rstrip(']')}), "
                    f"and this check numbers a port's bits from 0: a range that does not start at 0 is not read yet.")
            fix = f"declare {b} [{len([q for q in ports if q.split('[')[0] == b]) - 1}:0] and use the names from {b}[0] in the XDC; if the handout numbers from 1, this check is what stops you, not Vivado."
        elif p in cline:
            text = f"{p} has no pin in the XDC: the line that names it starts with # (commented out), so it does not count."
            fix = f"remove the # at the start of that line (the same name, the index the design uses: {p})."
        elif b in xdc_base:
            text = f"{p} has no pin in the XDC: no line names it (the XDC has lines for {b} with other indices, none for {p})."
            fix = f"add a line for {p} to the XDC (copy a {b} line, change the index and the pin), or make the port narrower."
        else:
            near = xdc_lower.get(p.lower())
            text = f"{p} has no pin in the XDC: no line names it" + (f" (the XDC has '{near}': same name, different case)." if near else " (the course file uses clk, sw, led, btnC btnU btnL btnR btnD, seg, dp, an).")
            fix = (f"rename the port in the module to {near.split('[')[0]}, or the name inside [get_ports ...] on the XDC line to {p.split('[')[0]}." if near
                   else "rename the port in the module to a name the XDC has, or change the name inside [get_ports ...] on its line of the XDC (a line that starts with # is commented out and does not count).")
        loc = f"{xf}:{cline[p]}" if (b not in form and p in cline) else where(p)
        print(msg("ERROR", "port-without-pin", text, fix, loc=loc))
        shown += 1
        if shown == 12 and len(missing) > 14:
            print(msg("ERROR", "port-without-pin", f"... and {len(missing) - shown} more ports of {tname} with no pin in the XDC (the same problem): {', '.join(missing[shown:])}.", "the same fix for each."))
            break
    sys.exit(1)
no_iostd = sorted(p for p in ports if p in has_pin and p not in has_iostd)
for p in no_iostd:
    print(msg("ERROR", "no-iostandard-property", f"{p} has a PACKAGE_PIN but no IOSTANDARD in the XDC: every pin needs both, and nextpnr stops without one.",
              f"add the line  set_property IOSTANDARD LVCMOS33 [get_ports {{{p}}}]", loc=f"{xf}:{xline[p]}"))
if no_iostd: sys.exit(1)

# 3) the pin names of the design's ports: a pin the chip does not have (a typo, a pin of another board, a power
# pin, a name in small letters: nextpnr reads W5 and not w5), and one pin given to two ports. nextpnr stops on
# both with a line that names no XDC line; here the line is named before it runs. The course's Basys3_Master.xdc
# next to this script gives the fix: the pin it puts the port on. Unused pins in the XDC are not looked at, as
# nextpnr does not look at them.
def master_pins():
    """port -> pin from templates/Basys3_Master.xdc (its lines are commented out), {} when it is not there"""
    out = {}
    try: lines = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "Basys3_Master.xdc"), encoding="utf-8", errors="replace")
    except OSError: return out
    for raw in lines:
        m = re.search(r"PACKAGE_PIN\s+([A-Za-z0-9]+).*get_ports\s*\{?\s*([A-Za-z_]\w*(?:\[\d+\])?)", raw)
        if m: out[m.group(2)] = m.group(1)
    return out
pinned = sorted((p for p in ports if p in has_pin and p in pin_of), key=by_index)
bad_pins = 0
if pins_csv and os.path.isfile(pins_csv):
    chip = set()
    for ln, raw in enumerate(open(pins_csv, encoding="utf-8", errors="replace")):
        if ln and raw.strip(): chip.add(raw.split(",")[0].strip())
    master = master_pins()
    for p in pinned:
        pin = pin_of[p]
        if pin in chip: continue
        bad_pins += 1
        on = f" (the course's Basys3_Master.xdc puts {p} on {master[p]})" if p in master else ""
        if pin.upper() in chip:
            text = f"{pin} is written in small letters, and the chip's pin names are capitals ({pin.upper()}): nextpnr reads {pin} as a pin the chip does not have, so {p} would have no pin."
            fix = f"write  PACKAGE_PIN {pin.upper()}  on this line."
        else:
            text = (f"{pin} is not an I/O pin of the Basys3's chip (xc7a35tcpg236; a pin is a letter and a number, in capitals: W5, U16, V17), "
                    f"so {p} would have no pin and nextpnr would stop here.")
            fix = f"write the pin {p} is wired to on this line{on}: copy its line from Basys3_Master.xdc, or take the pin from the board's schematic."
        print(msg("ERROR", "no-such-pin", text, fix, loc=f"{xf}:{xline[p]}"))
users = {}
for p in pinned: users.setdefault(pin_of[p], []).append(p)
for pin, ps in sorted(users.items(), key=lambda kv: xline[kv[1][0]]):
    if len(ps) < 2: continue
    bad_pins += 1
    where_ = " and ".join(f"{q} ({xf}:{xline[q]})" for q in ps)
    print(msg("ERROR", "pin-used-twice", f"pin {pin} is given to {len(ps)} ports, {where_}: one pin takes one port, so nextpnr would stop here.",
              f"give each port its own pin: copy their lines from the course's Basys3_Master.xdc (" + ", ".join(f"{q} is on {master_pins().get(q, '?')}" for q in ps) + ").",
              loc=f"{xf}:{xline[ps[-1]]}"))
if bad_pins: sys.exit(1)
# pins in the XDC that the design does not use are fine (nextpnr ignores them); a whole
# uncommented Basys3_Master.xdc is the normal lab setup, and led[15] with a led[1:0] port is just
# an unused pin. Only a case difference (LED vs led) looks like a typo, so only that gets a warning.
base = {q.split("[")[0] for q in ports}
lower = {b.lower(): b for b in base}
typos = [p for p in extra if p.split("[")[0] not in base and p.split("[")[0].lower() in lower]
for p in typos:
    print(msg("warning", "xdc-port-case", f"the XDC names '{p}' but the design's port is spelled {lower[p.split('[')[0].lower()]} (same name, different case), so this line is an unused pin.",
              "make the two spellings the same.", loc=f"{xf}:{xline[p]}"))
print(f"xdc ok: {len(ports)} ports, all mapped" + (f", {len(extra)} unused pins in the XDC ignored." if extra else "."))
