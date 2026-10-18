#!/usr/bin/env python3
"""One page per record: the SystemVerilog probes, the patch notes, the guide's sections.

  test/sv/expect.tsv + test/sv/<id>/   -> site/sv/index.html and site/sv/<id>/index.html
  docs/patch-notes.md                  -> site/patch-notes/<n>/index.html (the full list stays
                                          docs/patch-notes-build.py's, which links each entry here)
  docs/manual-setup.md                 -> site/docs/<slug>/index.html (the whole guide stays
                                          docs/build.sh's, whose contents list links each page here)

  python3 docs/pages-build.py                     the types in TYPES
  python3 docs/pages-build.py --only sv,notes     some types; links into a type left out are not made
  python3 docs/pages-build.py --check             exit 1 when a probe page differs from test/sv (site-check)

Run after editing any of the three sources; the output is committed. Needs pandoc and python3.
Idempotent: a second run writes the same bytes. Every page's text comes from its record: the
probe's row and files, the entry, the section. What is generated around it is the navigation,
the headings and the counts, all read from the same sources.

What gets a page, and what does not:
  sv     every row of expect.tsv
  notes  every numbered entry, and the unnumbered ones in NOTE_SLUGS, except NOTES_LEFT_OUT
         (the CLI as a tool, its install and its agent interface: those pages wait; mail and
         accounts: not launched) and entries under THIN words, which stay in the full list only
  guide  every section of THIN words or more, except GUIDE_LEFT_OUT (sections 2, 6 and 7 are about
         the CLI and wait); a shorter subsection is printed on its parent's page

Ends with the head, nav and link checks: every title, h1 and description unique among the pages
written, every /dewfpga/ href resolves in the site tree, anchors included. Then docs/nav.py.
"""
import argparse, html, json, os, re, subprocess, sys
from pathlib import Path

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.dont_write_bytecode = True
sys.path.insert(0, "docs")
from nav import render  # noqa: E402

SITE = Path("site")
HOST = "https://nosey-dewdrop.github.io/dewfpga/"
GITHUB = "https://github.com/nosey-dewdrop/dewfpga"
TYPES = ["sv", "notes", "guide", "agents"]  # what a plain run builds
THIN = 150  # words: a patch note shorter than this stays in the full list only

NOTES_LEFT_OUT = {
    1: "the CLI's uninstall and version", 6: "the CLI's own tests", 7: "the installer",
    11: "the CLI's install steps", 13: "the VS Code integration", 14: "the CLI's --json results",
    15: "the agent interface (MCP)", 16: "the agent experiment", 24: "newsletter, not launched",
    25: "mail, not launched", 26: "accounts, not launched", 30: "the installer",
}
# unnumbered entries that get a page: heading text -> folder
NOTE_SLUGS = {
    "Unreleased: preserve vector indices in pin validation": "pin-validation-vector-indices",
    "Local candidate · The course's ready netlist modules build · 15 October": "course-netlist-modules",
}
# thin entries printed together on one page: folder -> their numbers or headings
NOTE_MERGE = {}
# guide sections. A section of THIN words or more gets its own page, in the folder named here; a
# shorter subsection is printed on its parent's page, a shorter section stays in the whole guide only.
GUIDE_LEFT_OUT = {"2": "the one-line install", "6": "VS Code, set up by the CLI", "7": "the CLI's messages"}
GUIDE_SLUGS = {
    "1": "before-you-start", "3": "build-by-hand", "3.1": "homebrew-packages", "3.2": "python-venv",
    "3.3": "nextpnr-xilinx", "3.4": "chip-database", "3.5": "prjxray", "3.6": "yosys-slang",
    "3.7": "after-the-builds", "4": "project-folder", "5": "your-own-lab", "7.1": "course-files-that-break",
    "8": "limits", "9": "tested-versions",
}
GUIDE_RELATED = {"7.1": "sv", "8": "sv"}
# docs/agent-interface.md: its h1 and each `## ` part -> folder under site/agents/
AGENT_SLUGS = {"Machine-readable CLI": "json", "MCP server": "mcp"}
# the commands bin/dewfpga's help lists; a command named here has no page of its own
CLI_NO_PAGE = {"--version": "one line", "mcp": "its page is the MCP server's, /agents/mcp/"}

ICON = """<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90' fill='%235b2fc9'%3E%E2%9C%B3%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/dewfpga/s.css">
<script defer src="/dewfpga/s.js"></script>
"""
FOOT = """
<footer class="wrap">
  <span>built by <a href="https://noseydewdrop.com">Damla Su Bilge</a> · MIT · <a href="https://github.com/nosey-dewdrop/dewfpga">source</a> · <a href="https://www.linkedin.com/in/damla-su-bilge-278841278/">linkedin</a></span>
  <span>{links}</span>
</footer>
{script}</body>
</html>
"""
COPY_ALL = '<script>document.querySelectorAll("main pre").forEach(function(p){p.setAttribute("data-copy","1")})</script>\n'
esc = html.escape
# a heading that starts like a question must end with "?" (test/site-check.py); a probe's construct
# that starts with such a word ("do ... while") is named "SystemVerilog do ... while" instead
QUESTION = re.compile(r"^(why|how|what|which|who|when|where|is|are|do|does|did|can|could|should|would|will|has|have|was|were)\b", re.I)


def head(title, desc, url, active, ld):
    """the same head as docs/errors-build.sh writes"""
    return ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
            "<meta name=\"author\" content=\"Damla Su Bilge\">\n"
            "<link rel=\"author\" href=\"https://noseydewdrop.com\">\n"
            f"<title>{esc(title)}</title>\n"
            f"<meta name=\"description\" content=\"{esc(desc)}\">\n"
            f"<link rel=\"canonical\" href=\"{url}\">\n"
            "<meta property=\"og:type\" content=\"article\">\n"
            f"<meta property=\"og:title\" content=\"{esc(title)}\">\n"
            f"<meta property=\"og:description\" content=\"{esc(desc)}\">\n"
            f"<meta property=\"og:url\" content=\"{url}\">\n"
            "<meta property=\"og:image\" content=\"https://nosey-dewdrop.github.io/dewfpga/og.png\">\n"
            "<meta name=\"twitter:card\" content=\"summary_large_image\">\n" + ICON
            + "<script type=\"application/ld+json\">" + json.dumps(ld, ensure_ascii=False, separators=(",", ":")) + "</script>\n"
            + "</head>\n<body>\n" + render("en", active) + "\n")


def article(headline, url):
    return {"@context": "https://schema.org", "@type": "TechArticle", "headline": headline, "url": url,
            "author": {"@type": "Person", "name": "Damla Su Bilge"}, "inLanguage": "en"}


def pandoc(md, fmt="gfm"):
    out = subprocess.run(["pandoc", "-f", fmt, "-t", "html5", "--wrap=none", "--syntax-highlighting=none"],
                         input=md, text=True, capture_output=True, check=True).stdout
    return out.strip("\n") + "\n"


def plain(fragment):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", fragment)).split())


def summary(text, limit=200):
    """whole sentences of the record's own text, up to about limit characters; a sentence that
    does not fit is cut at a word"""
    sentences = re.split(r"(?<=[.!?:])\s+(?=[A-Z`(\"'])", text)
    out = ""
    for s in sentences:
        if len(out) + 1 + len(s) <= limit:
            out = (out + " " + s).strip()
            continue
        if len(out) < limit // 2:
            out = (out + " " + s).strip()[:limit].rsplit(" ", 1)[0].rstrip(",;:(") + "…"
        break
    return out


def words(md):
    return len(re.sub(r"[`*#|>-]", " ", md).split())


STALE = None  # --check: the pages that differ from what the sources make, instead of writing them


def write(path, text):
    old = path.read_text() if path.is_file() else None
    if STALE is not None:
        if old != text:
            STALE.append(str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    if old != text:
        path.write_text(text)


# ---------------------------------------------------------------- the records

def error_codes():
    """docs/errors.md: code -> summary (the key: value block under each `## code`)"""
    out, lines = {}, Path("docs/errors.md").read_text().split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^## ([a-z0-9][a-z0-9-]*)\s*$", line)
        j = i + 1
        while m and j < len(lines) and lines[j].strip():
            if lines[j].startswith("summary:"):
                out[m.group(1)] = lines[j].partition(":")[2].strip()
            j += 1
    return out


def probes():
    lines = Path("test/sv/expect.tsv").read_text().rstrip("\n").split("\n")
    keys = lines[0].split("\t")
    rows = [dict(zip(keys, l.split("\t"))) for l in lines[1:]]
    for r in rows:
        if len(r) != len(keys) or not Path("test/sv", r["id"]).is_dir():
            sys.exit(f"test/sv/expect.tsv: row {r.get('id')!r} has {len(r)} fields or no folder")
    return rows


def notes():
    """docs/patch-notes.md: (key, number or None, heading, title, date, body) per entry"""
    lines = Path("docs/patch-notes.md").read_text().split("\n")
    starts = [i for i, l in enumerate(lines) if l.startswith("### ") or l.startswith("## Unreleased:")]
    stops = [i for i, l in enumerate(lines) if re.match(r"^#{2,3} ", l)]
    out = []
    for s in starts:
        e = next((i for i in stops if i > s), len(lines))
        heading = re.sub(r"^#+ ", "", lines[s]).strip()
        body = "\n".join(lines[s + 1:e]).strip("\n")
        m = re.match(r"#(\d+) · (.*) · (.*)$", heading)
        if m:
            out.append((m.group(1), int(m.group(1)), heading, m.group(2), m.group(3), body))
        elif heading in NOTE_SLUGS or heading in {m for ms in NOTE_MERGE.values() for m in ms}:
            parts = heading.split(" · ")
            title = parts[1] if len(parts) == 3 else heading.split(": ", 1)[1]
            date = parts[2] if len(parts) == 3 else ""
            out.append((NOTE_SLUGS.get(heading), None, heading, title[0].upper() + title[1:], date, body))
    return out


def note_pages():
    """[(folder, [entries])]: an entry of THIN words or more on its own page; the thin entries named
    together in NOTE_MERGE on one page; the rest only in the full list"""
    merged = {m: folder for folder, ms in NOTE_MERGE.items() for m in ms}
    out, done = [], set()
    for e in notes():
        ident = e[1] if e[1] is not None else e[2]
        if ident in merged:
            folder = merged[ident]
            if folder not in done:
                group = [x for x in notes() if (x[1] if x[1] is not None else x[2]) in NOTE_MERGE[folder]]
                if any(words(x[5]) >= THIN for x in group):
                    sys.exit(f"NOTE_MERGE {folder}: an entry of {THIN} words or more gets a page of its own")
                if sum(words(x[5]) for x in group) >= THIN:
                    out.append((folder, group))
                done.add(folder)
        elif e[0] and e[1] not in NOTES_LEFT_OUT and words(e[5]) >= THIN:
            out.append((e[0], [e]))
    return out


def note_label(group):
    """'#9 One navigation source…', '#18, #21, #22 A workspace…; …', 'Preserve vector indices…'"""
    nums = [e[1] for e in group if e[1]]
    titles = "; ".join(plain(pandoc(e[3])) for e in group)
    return (", ".join(f"#{n}" for n in nums) + " " if nums else "") + titles


def guide_sections():
    """docs/manual-setup.md: number -> (heading, markdown body without the heading)"""
    text = re.sub(r"<!--.*?-->\n?", "", Path("docs/manual-setup.md").read_text(), flags=re.S)
    lines = text.split("\n")
    heads = [(i, m.group(1), m.group(2), m.group(3)) for i, l in enumerate(lines)
             for m in [re.match(r"^(#{2,3}) (\d+(?:\.\d+)?)\.? (.*)$", l)] if m]
    out = {}
    for k, (i, level, num, title) in enumerate(heads):
        e = heads[k + 1][0] if k + 1 < len(heads) else len(lines)
        body = "\n".join(lines[i + 1:e])
        body = re.sub(r'\n<a id="[^"]*"></a>\s*$', "", body.rstrip())
        body = re.sub(r"\n---\s*$", "", body.rstrip()).strip("\n")
        out[num] = (level, title, body)
    return out


def guide_ids():
    """the ids pandoc gave the guide's headings in site/docs/index.html, by section number"""
    page = (SITE / "docs/index.html").read_text()
    ids = {}
    for hid, text in re.findall(r'<h[23] id="([^"]+)">(.*?)</h[23]>', page):
        m = re.match(r"(\d+(?:\.\d+)?)\.? ", plain(text))
        if m:
            ids[m.group(1)] = hid
    return ids


def md_blocks(md):
    """markdown -> [(kind, text)]: kind is head, code, table or prose; a list item is a block of its own"""
    md = re.sub(r"<!--.*?-->", "", md, flags=re.S)
    out, cur, kind, fence = [], [], "prose", False

    def flush():
        if cur:
            out.append((kind, "\n".join(cur)))
        cur.clear()
    for l in md.split("\n"):
        if l.startswith("```"):
            if not fence:
                flush()
                kind, fence = "code", True
                cur.append(l)
            else:
                cur.append(l)
                flush()
                kind, fence = "prose", False
            continue
        if fence:
            cur.append(l)
            continue
        if not l.strip():
            flush()
            continue
        if l.startswith("#"):
            flush()
            out.append(("head", l))
            continue
        if re.match(r"^([-*]|\d+\.) ", l) or (l.startswith("|") and not (cur and cur[0].startswith("|"))) \
                or (cur and cur[0].startswith("|") and not l.startswith("|")):
            flush()
        kind = "table" if l.startswith("|") else "prose"
        cur.append(l)
    flush()
    return out


def error_entries():
    """docs/errors.md: code -> its key: value lines"""
    out, lines = {}, Path("docs/errors.md").read_text().split("\n")
    for i, line in enumerate(lines):
        m = re.match(r"^## ([a-z0-9][a-z0-9-]*)\s*$", line)
        j = i + 1
        while m and j < len(lines) and lines[j].strip():
            k, _, v = lines[j].partition(":")
            out.setdefault(m.group(1), {})[k.strip()] = v.strip()
            j += 1
    return out


def cli_help():
    """bin/dewfpga's help text (the lines its usage() prints): command -> its entry, in that order"""
    lines = [re.sub(r"^# ?", "", l) for l in Path("bin/dewfpga").read_text().split("\n")[1:17]]
    entries = []
    for l in lines:
        if re.match(r"^  dewfpga ", l):
            entries.append([l])
        elif entries and l.startswith("   "):
            entries[-1].append(l)
    out = {}
    for e in entries:
        for c in cmd_words(e[0].strip()[len("dewfpga "):]):
            out[c] = "\n".join(x[2:] for x in e)
    return out


def cmd_words(line):
    """'sim | bit | flash | clean [top]   work on ...' -> [sim, bit, flash, clean]"""
    first = re.split(r"\s{2,}", line.strip())[0]
    return [w for w in re.split(r"[\s|]+", first.split("[")[0].split("<")[0]) if w]


def cli_lines():
    """the one-line description of each command on the cli page (site/cli/index.html, its command list)"""
    page = html.unescape((SITE / "cli/index.html").read_text())
    return {m.group(1): m.group(2).strip() for m in re.finditer(r"^dewfpga (\S+)(?: \S+)?\s{2,}(.+)$", page, re.M)}


def cmd_re(c):
    return re.compile(r"\bdewfpga " + re.escape(c) + r"(?![\w-])")


def cli_cmds(types):
    """the commands with a page (cli) and the agent pages (agents), in the help's order"""
    out = [c for c in cli_help() if c not in CLI_NO_PAGE] if "cli" in types else []
    return out + (["json", "mcp"] if "agents" in types else [])


def cmd_href(c):
    return f"/dewfpga/agents/{c}/" if c in ("json", "mcp") else f"/dewfpga/cli/{c}/"


def cmd_label(c):
    return {"json": "dewfpga … --json", "mcp": "dewfpga mcp"}.get(c, f"dewfpga {c}")


def commands_in(text, types):
    """the commands with a page that a record names (`dewfpga bit`, `--json`, `dewfpga mcp`)"""
    have = cli_cmds(types)
    found = [c for c in have if c not in ("json", "mcp") and cmd_re(c).search(text)]
    if "json" in have and re.search(r"(?<![\w-])--json\b", text):
        found.append("json")
    if "mcp" in have and (cmd_re("mcp").search(text) or "MCP" in text):
        found.append("mcp")
    return found


def commands_line(text, types, what, own=None):
    cs = [c for c in commands_in(text, types) if c != own]
    if not cs:
        return None
    return f"The commands {what} names: " + " · ".join(f"<a href=\"{cmd_href(c)}\"><code>{esc(cmd_label(c))}</code></a>" for c in cs)


def error_commands(types):
    """docs/errors.md: code -> the command pages it belongs to, read from its step: and source: lines"""
    have, out = cli_cmds(types), {}
    for code, m in error_entries().items():
        found = set(re.split(r"[\s,/]+", m.get("step", "").lower()))
        for mm in re.finditer(r"\bdewfpga ([a-z]+(?:\s*/\s*[a-z]+)*)", m.get("source", "")):
            found |= set(re.split(r"\s*/\s*", mm.group(1)))
        if "MCP" in m.get("source", "") or code.startswith("mcp"):
            found.add("mcp")
        elif "agent" in found:
            found.add("json")
        cs = [c for c in have if c in found]
        if cs:
            out[code] = cs
    return out


# ---------------------------------------------------------------- probes

STAGES = [
    ("rtl", "simulation", "The design and its <code>tb.sv</code> simulated with Icarus Verilog (<code>dewfpga sim</code>). Pass: exit 0 and the testbench printed <code>PASS</code>."),
    ("synth", "synthesis", "Yosys synthesis (<code>dewfpga bit</code>), with the whole <code>Basys3_Master.xdc</code> uncommented as in a lab folder. Pass: the netlist was written."),
    ("netlist", "the netlist", "That netlist written back as Verilog: the same <code>tb.sv</code>, simulated on it with Yosys' <code>xilinx/cells_sim.v</code>, prints <code>PASS</code>, and every output bit matches the RTL on the same inputs (<code>test/sv/eqv.py</code>). This stage checks what synthesis made, not place and route or the bitstream."),
    ("bit", "the bitstream", "The same <code>dewfpga bit</code> exits 0 and writes <code>top.bit</code>: place and route with nextpnr-xilinx, the timing check, the frames and the bitstream."),
]
OUTCOMES = [  # key, list heading, the sentence a probe page says
    ("all", "Which probes pass every stage?", "all four stages pass"),
    ("netlist", "Which probes build a bitstream whose netlist check fails?", "it builds a bitstream, and the netlist check fails"),
    ("stop", "Which probes stop before a bitstream?", "it stops before a bitstream"),
    ("sim", "Which probes build, and fail only in simulation?", "it builds, and fails in simulation"),
]


def outcome(r):
    if r["bit"] != "pass":
        return "stop"
    if r["netlist"] == "fail":
        return "netlist"
    if r["rtl"] != "pass":
        return "sim"
    return "all"


def probe_num(pid):
    return pid.split("_", 1)[0]


def probe_files(pid):
    d = Path("test/sv", pid)
    fs = sorted(p.name for p in d.iterdir() if p.is_file() and p.suffix in (".sv", ".v", ".svh", ".mem"))
    first = [f for f in fs if f.startswith("design.")]
    last = [f for f in fs if f == "tb.sv"]
    return first + [f for f in fs if f not in first and f not in last] + last, sorted(p.name for p in d.iterdir() if p.suffix == ".xdc")


def link_record(text, codes, note_link):
    """escape a record's text; its [code]s link to their error pages, its #N to the patch note"""
    t = esc(text, quote=False)
    t = re.sub(r"\[([a-z0-9][a-z0-9-]*)\]",
               lambda m: f'[<a href="/dewfpga/errors/{m.group(1)}/">{m.group(1)}</a>]' if m.group(1) in codes else m.group(0), t)
    t = re.sub(r"(?<![\w&;/])#(\d+)\b", lambda m: note_link(int(m.group(1)), m.group(0)), t)
    return t


def build_sv(types, written):
    rows, codes = probes(), error_codes()
    numbered = {n for _, n, *_ in notes() if n}
    with_page = {e[1]: key for key, group in note_pages() for e in group if e[1]} if "notes" in types else {}

    def note_link(n, label):
        if n in with_page:
            return f'<a href="/dewfpga/patch-notes/{with_page[n]}/">{label}</a>'
        if n in numbered:
            return f'<a href="/dewfpga/patch-notes/#{n}">{label}</a>'
        return label

    for k, r in enumerate(rows):
        pid, construct = r["id"], r["construct"]
        url = f"{HOST}sv/{pid}/"
        oc = next(o for o in OUTCOMES if o[0] == outcome(r))
        named = ("SystemVerilog " + construct) if QUESTION.match(construct) else construct
        title = f"{named} · Vivado: {r['vivado']} · open-source chain: {oc[2]}"
        desc = (f"{construct}. Vivado: {r['vivado']}. With Yosys, nextpnr-xilinx and Icarus Verilog on a Mac, "
                f"{oc[2]}. Probe {probe_num(pid)} of the dewfpga test suite, with its code and the source for Vivado's verdict.")
        p = head(title, desc, url, None, article(construct, url))
        p += "<main class=\"wrap\">\n"
        p += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/sv/\">SystemVerilog probes</a> · "
              f"<span class=\"step\">{esc(probe_num(pid))}</span>Vivado: {esc(r['vivado'])}</p>\n")
        p += f"  <h1>{esc(named)}</h1>\n"
        p += f"<p>Vivado: {esc(r['vivado'])}. The open-source chain: {oc[2]}.</p>\n"
        p += "<table>\n<tr><th>stage</th><th>today</th></tr>\n"
        for key, name, _ in STAGES:
            v = {"pass": "pass", "fail": "fail", "-": "not run"}.get(r[key], r[key])
            p += f"<tr><td><a href=\"/dewfpga/sv/#{key}\">{key}</a>, {name}</td><td>{esc(v)}</td></tr>\n"
        p += "</table>\n"
        p += "<h2 id=\"vivado\">What does Vivado do with it?</h2>\n"
        p += f"<p><b>{esc(r['vivado'].capitalize())}.</b> {link_record(r['vivado_source'], codes, note_link)}</p>\n"
        p += "<h2 id=\"today\">What does the open-source chain do with it?</h2>\n"
        if r["today"].strip() == "-":
            p += f"<p>{oc[2].capitalize()}; <code>expect.tsv</code> records no message for this probe.</p>\n"
        else:
            p += f"<p>{link_record(r['today'], codes, note_link)}</p>\n"
        hit = sorted({c for c in re.findall(r"\[([a-z0-9][a-z0-9-]*)\]", r["today"]) if c in codes})
        if hit:
            p += "<h2 id=\"errors\">Which error pages explain the messages?</h2>\n<ul>\n"
            for c in hit:
                p += f"<li><a href=\"/dewfpga/errors/{c}/\">{c}</a>: {esc(codes[c])}</li>\n"
            p += "</ul>\n"
        files, xdc = probe_files(pid)
        p += "<h2 id=\"code\">What is the probe's code?</h2>\n"
        p += (f"<p class=\"mute small\">From <a href=\"{GITHUB}/tree/main/test/sv/{pid}\">test/sv/{esc(pid)}</a>"
              + (f", next to the lab's own <code>{esc(xdc[0])}</code>" if xdc else "") + ".</p>\n")
        for f in files:
            p += f"<p><code>{esc(f)}</code></p>\n<pre data-copy=\"1\"><code>{esc(Path('test/sv', pid, f).read_text().rstrip(), quote=False)}</code></pre>\n"
        prev_, next_ = rows[k - 1] if k else None, rows[k + 1] if k + 1 < len(rows) else None
        nav = []
        if prev_:
            nav.append(f"previous: <a href=\"/dewfpga/sv/{prev_['id']}/\">{esc(prev_['construct'])}</a>")
        if next_:
            nav.append(f"next: <a href=\"/dewfpga/sv/{next_['id']}/\">{esc(next_['construct'])}</a>")
        p += "<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "</p>\n"
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/sv/">all probes</a> · <a href="/dewfpga/errors/">errors</a>', script="")
        write(SITE / "sv" / pid / "index.html", p)
        written.append((SITE / "sv" / pid / "index.html", title, named, desc))

    # the index
    url = HOST + "sv/"
    n = len(rows)
    sup = sum(r["vivado"] == "supported" for r in rows)
    groups = {o[0]: [r for r in rows if outcome(r) == o[0]] for o in OUTCOMES}
    sup_all = sum(r["vivado"] == "supported" and outcome(r) == "all" for r in rows)
    title = "Which SystemVerilog builds without Vivado? Every probe, stage by stage"
    h1 = "Which SystemVerilog builds without Vivado?"
    desc = (f"{n} SystemVerilog constructs, one probe each, run through simulation, Yosys synthesis, a check of the "
            f"synthesized netlist and the Basys3 bitstream on a Mac, next to what Vivado does with the same code and the source for it.")
    p = head(title, desc, url, None, article(h1, url))
    p += "<main class=\"wrap\">\n"
    p += f"  <h1>{esc(h1)}</h1>\n"
    p += (f"  <p class=\"lead\">{n} constructs, one probe each: the design and a "
          f"<code>tb.sv</code> that prints <code>PASS</code>. Vivado supports {sup} of them; {sup_all} of those pass every stage here.</p>\n")
    p += ("<p>Every probe in <a href=\"" + GITHUB + "/tree/main/test/sv\">test/sv</a> goes through four stages in a folder that holds "
          "only its sources. <code>test/sv/expect.tsv</code> records what each stage does today, whether Vivado accepts the construct "
          "and the source for that; <code>test/sv/run.sh</code> fails on any difference, in both directions. Sources for Vivado: "
          "UG901 v2023.2 (chapter, table, page), UG953 v2022.2 (the 7-series primitive guide) and Vivado logs from public CS223 lab "
          "repos, where the student's module and signal names are replaced by a description. A forum is marked as a weak source.</p>\n")
    p += "<h2 id=\"stages\">What does each stage check?</h2>\n<table>\n"
    for key, name, what in STAGES:
        p += f"<tr id=\"{key}\"><td><b>{key}</b><br>{name}</td><td>{what}</td></tr>\n"
    p += "</table>\n"
    for key, question, _ in OUTCOMES:
        g = groups[key]
        if not g:
            continue
        p += f"<h2 id=\"outcome-{key}\">{esc(question)}</h2>\n<p class=\"mute small\">{len(g)} of {n}.</p>\n<ul>\n"
        for r in g:
            p += (f"<li><a href=\"/dewfpga/sv/{r['id']}/\">{esc(r['construct'])}</a> "
                  f"<span class=\"mute\">({esc(probe_num(r['id']))}, Vivado: {esc(r['vivado'])})</span></li>\n")
        p += "</ul>\n"
    p += ("<hr>\n<p class=\"mute small\">An error code from one of these runs? <a href=\"/dewfpga/errors/\">Every code, with what you saw, "
          "why and the fix.</a> What the chain cannot do yet, in the guide: <a href=\"/dewfpga/docs/" +
          ("limits/" if "guide" in types else "#8-what-can-it-not-do") + "\">section 8</a>.</p>\n")
    p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/errors/">errors</a> · <a href="/dewfpga/">home</a>', script="")
    write(SITE / "sv/index.html", p)
    written.append((SITE / "sv/index.html", title, h1, desc))
    return f"site/sv: {n} probes + index"


# ---------------------------------------------------------------- patch notes

def note_folder(key):
    return SITE / "patch-notes" / str(key) / "index.html"


def build_notes(types, written):
    pages = note_pages()
    keys = [k for k, _ in pages]
    for i, (key, group) in enumerate(pages):
        url = f"{HOST}patch-notes/{key}/"
        nums = [e[1] for e in group if e[1]]
        label = ", ".join(f"#{n}" for n in nums) if nums else group[0][2].split(":")[0].split(" · ")[0].lower()
        ptitle = "; ".join(plain(pandoc(e[3])) for e in group)
        page_title = (f"{label} {ptitle}" if nums else ptitle) + ": dewfpga patch notes"
        if len(group) == 1:
            body_md = group[0][5]
        else:
            body_md = "\n\n".join(f"## {e[2]}\n\n{e[5]}" for e in group)
        bodyhtml = pandoc(body_md, "gfm-tex_math_dollars-raw_html")
        desc = summary(plain(bodyhtml if len(group) == 1 else re.sub(r"<h2.*?</h2>", "", bodyhtml)))
        h1 = f"{label} · {ptitle}" if nums else ptitle
        dates = " · ".join(dict.fromkeys(e[4] for e in group if e[4]))
        p = head(page_title, desc, url, "c-notes", article(h1, url))
        p += "<main class=\"wrap docs\">\n"
        p += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/patch-notes/\">patch notes</a> · <span class=\"step\">{esc(label)}</span>"
              f"{esc(dates)}</p>\n")
        h1_html = "; ".join(pandoc(e[3]).strip()[3:-4] for e in group)
        p += f"  <h1>{(esc(label) + ' · ') if nums else ''}{h1_html}</h1>\n"
        p += bodyhtml
        nav = []
        if i:
            nav.append(f"previous: <a href=\"/dewfpga/patch-notes/{pages[i - 1][0]}/\">{esc(note_label(pages[i - 1][1]))}</a>")
        if i + 1 < len(pages):
            nav.append(f"next: <a href=\"/dewfpga/patch-notes/{pages[i + 1][0]}/\">{esc(note_label(pages[i + 1][1]))}</a>")
        where = f"/dewfpga/patch-notes/#{nums[0]}" if nums else "/dewfpga/patch-notes/"
        nav.append(f"<a href=\"{where}\">{'This entry' if len(group) == 1 else 'These entries'} in the full list</a>")
        line = commands_line(body_md, types, "this entry" if len(group) == 1 else "these entries")
        if line:
            nav.append(line)
        if "sv" in types:
            nav.append("Every SystemVerilog construct measured so far, next to what Vivado does: <a href=\"/dewfpga/sv/\">the probes, stage by stage</a>")
        p += "<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "</p>\n"
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/patch-notes/">all patch notes</a> · <a href="/dewfpga/">home</a>', script=COPY_ALL)
        write(note_folder(key), p)
        written.append((note_folder(key), page_title, plain(h1_html if not nums else h1), desc))
    stale = sorted(d.name for d in (SITE / "patch-notes").iterdir() if d.is_dir() and d.name not in {str(k) for k in keys})
    paged = {e[2] for _, g in pages for e in g}
    rest = [e for e in notes() if e[2] not in paged]
    left = [e for e in rest if e[1] in NOTES_LEFT_OUT]
    thin = [e for e in rest if e[1] not in NOTES_LEFT_OUT]
    return (f"site/patch-notes: {len(pages)} pages for {len(paged)} entries; left out {len(left)}; "
            f"only in the full list: {' '.join(('#' + str(e[1])) if e[1] else repr(e[2][:30]) for e in thin) or 'none'}"
            + (f"; folders without an entry: {' '.join(stale)}" if stale else ""))


# ---------------------------------------------------------------- the guide

def guide_pages(secs):
    """[(number, folder)] in the guide's order, and {subsection: the page it is printed on}"""
    def parent(n):
        return n.split(".")[0] if "." in n else None
    own = [n for n in secs if n not in GUIDE_LEFT_OUT and words(secs[n][2]) >= THIN]
    for n in own:
        if n not in GUIDE_SLUGS:
            sys.exit(f"docs/manual-setup.md: section {n} has {THIN} words or more; give it a folder in GUIDE_SLUGS")
    folded = {n: parent(n) for n in secs if n not in own and parent(n) in own}
    return [(n, GUIDE_SLUGS[n]) for n in own], folded


def build_guide(types, written):
    secs, ids = guide_sections(), guide_ids()
    pages, folded = guide_pages(secs)
    slug = dict(pages)

    def anchor_href(a):
        num = next((n for n, i in ids.items() if i == a), None)
        if num in slug:
            return f"/dewfpga/docs/{slug[num]}/"
        if num in folded:
            return f"/dewfpga/docs/{slug[folded[num]]}/#{a}"
        return f"/dewfpga/docs/#{a}"

    for i, (num, folder) in enumerate(pages):
        level, heading, body = secs[num]
        parent = secs[num.split(".")[0]][1] if "." in num else None
        md = body
        for n in [n for n in secs if n.split(".")[0] == num and "." in n]:
            if n in folded:
                md += f"\n\n## {n} {secs[n][1]}\n\n{secs[n][2]}"
            elif n in slug:   # its own page: the heading, its first sentence and the link
                first = re.split(r"(?<=\.)\s", secs[n][2].strip(), maxsplit=1)[0]
                md += f"\n\n## {n} {secs[n][1]}\n\n{first} On its own page: [{n} {secs[n][1]}](/dewfpga/docs/{slug[n]}/)."
        md = re.sub(r"\]\(#([^)]+)\)", lambda m: f"]({anchor_href(m.group(1))})", md)
        bodyhtml = pandoc(md, "gfm-tex_math_dollars")
        bodyhtml = bodyhtml.replace('<pre class="copy"><code>', '<pre data-copy="1"><code>')
        first = re.search(r"<p>(.*?)</p>", bodyhtml, re.S)
        desc = summary(plain(first.group(1)) if first else heading)
        url = f"{HOST}docs/{folder}/"
        parent_num = num.split(".")[0] if "." in num else None
        shown_parent = parent if parent_num in slug else None   # section 7 is about the CLI: not named
        if shown_parent and not heading.endswith("?"):
            title = f"{heading} · {parent} CS223 on a Mac, section {num}"
        else:
            title = f"{heading} CS223 on a Mac without Vivado, section {num}"
        p = head(title, desc, url, None, article(heading, url))
        p += "<main class=\"wrap docs\">\n"
        p += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/docs/\">the guide</a> · <span class=\"step\">{num}</span>"
              f"{esc(shown_parent or 'How do you run CS223 labs on a Mac without Vivado?')}</p>\n")
        p += f"  <h1>{esc(heading)}</h1>\n" + bodyhtml
        nav = []
        if i:
            pn, pf = pages[i - 1]
            nav.append(f"previous: <a href=\"/dewfpga/docs/{pf}/\">{pn} {esc(secs[pn][1])}</a>")
        if i + 1 < len(pages):
            nn, nf = pages[i + 1]
            nav.append(f"next: <a href=\"/dewfpga/docs/{nf}/\">{nn} {esc(secs[nn][1])}</a>")
        nav.append(f"<a href=\"/dewfpga/docs/#{ids[num]}\">This section in the whole guide</a>")
        if GUIDE_RELATED.get(num) == "sv" and "sv" in types:
            nav.append("Every SystemVerilog construct measured so far, next to what Vivado does: <a href=\"/dewfpga/sv/\">the probes, stage by stage</a>")
        p += ("<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "</p>\n"
              "<p class=\"mute small\">Stuck on an error? <a href=\"/dewfpga/errors/\">Every error from this setup, filed under the exact line it printed.</a></p>\n")
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/docs/">the whole guide</a> · <a href="/dewfpga/">home</a>', script=COPY_ALL)
        write(SITE / "docs" / folder / "index.html", p)
        written.append((SITE / "docs" / folder / "index.html", title, heading, desc))
    stale = sorted(d.name for d in (SITE / "docs").iterdir() if d.is_dir() and d.name not in set(slug.values()))
    return (f"site/docs: {len(pages)} section pages; on their parent's page: {' '.join(folded)}; "
            f"left out: {' '.join(sorted(GUIDE_LEFT_OUT))} (the CLI)"
            + "".join(f"; {n} under {THIN} words" for n in secs if n not in GUIDE_LEFT_OUT and n not in slug and n not in folded)
            + (f"; folders without a section: {' '.join(stale)}" if stale else ""))


def guide_contents():
    """the whole guide's contents list links each section that has a page; docs/build.sh calls this"""
    path = SITE / "docs/index.html"
    page, ids, slug = path.read_text(), guide_ids(), dict(guide_pages(guide_sections())[0])
    for num, hid in ids.items():
        if num in slug:
            # grey on the page, hidden in the PDF (docs/pdf.sh hides .mute); [^<]* keeps a second run from adding it twice
            li = re.compile(r'(<li><a href="#' + re.escape(hid) + r'">[^<]*</a>)(</li>)')
            page = li.sub(lambda m: m.group(1) + f'<span class="mute"> · <a href="/dewfpga/docs/{slug[num]}/">its own page</a></span>' + m.group(2), page, count=1)
    write(path, page)


# ---------------------------------------------------------------- agents and commands

def agent_parts():
    """docs/agent-interface.md: [(folder, heading, body)], the h1's part first, then each `## ` part"""
    text = Path("docs/agent-interface.md").read_text()
    parts = re.split(r"^(#{1,2} .*)$", text, flags=re.M)[1:]
    out = []
    for h, body in zip(parts[0::2], parts[1::2]):
        heading = h.lstrip("#").strip()
        if heading not in AGENT_SLUGS:
            sys.exit(f"docs/agent-interface.md: give the part {heading!r} a folder in AGENT_SLUGS")
        out.append((AGENT_SLUGS[heading], heading, body.strip("\n")))
    return out


def link_md(md, origin, types):
    """a source's own links, made to work on a page: README and agent-interface paths, guide anchors"""
    def one(m):
        target = m.group(2)
        if target.startswith(("http", "/", "mailto:")):
            return m.group(0)
        if origin == "guide" and target.startswith("#"):
            return f"{m.group(1)}({guide_link(target[1:], types)})"
        path, _, frag = target.partition("#")
        if path == "docs/agent-interface.md" and "agents" in types:
            return f"{m.group(1)}(/dewfpga/agents/{'mcp' if frag == 'mcp-server' else 'json'}/)"
        if not path:
            return f"{m.group(1)}({GITHUB}#{frag})"
        return f"{m.group(1)}({GITHUB}/blob/main/{path}{'#' + frag if frag else ''})"
    return re.sub(r"(\[[^\]]*\])\(([^)\s]+)\)", one, md)


def guide_link(anchor, types):
    """an anchor of the whole guide -> the page that holds that section, when it has one"""
    if "guide" not in types:
        return f"/dewfpga/docs/#{anchor}"
    secs, ids = guide_sections(), guide_ids()
    pages, folded = guide_pages(secs)
    slug = dict(pages)
    num = next((n for n, i in ids.items() if i == anchor), None)
    if num in slug:
        return f"/dewfpga/docs/{slug[num]}/"
    if num in folded:
        return f"/dewfpga/docs/{slug[folded[num]]}/#{anchor}"
    return f"/dewfpga/docs/#{anchor}"


def errors_list(cmd, types):
    entries, codes = error_entries(), [c for c, cs in error_commands(types).items() if cmd in cs]
    if not codes:
        return ""
    out = f"<h2 id=\"errors\">Which errors can it stop with?</h2>\n<p class=\"mute small\">{len(codes)} codes in the error catalog.</p>\n<ul>\n"
    for c in codes:
        out += f"<li><a href=\"/dewfpga/errors/{c}/\">{c}</a>: {esc(entries[c].get('summary', ''))}</li>\n"
    return out + "</ul>\n"


def notes_list(cmd, types):
    if "notes" not in types:
        return ""
    hits = [(key, group) for key, group in note_pages() if cmd in commands_in("\n".join(e[5] for e in group), types)]
    if not hits:
        return ""
    out = "<h2 id=\"patch-notes\">Which patch notes name it?</h2>\n<ul>\n"
    for key, group in hits:
        out += f"<li><a href=\"/dewfpga/patch-notes/{key}/\">{esc(note_label(group))}</a></li>\n"
    return out + "</ul>\n"


def build_agents(types, written):
    parts = agent_parts()
    for i, (folder, heading, body) in enumerate(parts):
        url = f"{HOST}agents/{folder}/"
        bodyhtml = pandoc(link_md(body, "agent", types))
        first = re.search(r"<p>(.*?)</p>", bodyhtml, re.S)
        desc = summary(plain(first.group(1)))
        title = f"{heading}: dewfpga for coding agents"
        p = head(title, desc, url, "c-cli", article(heading, url))
        p += "<main class=\"wrap docs\">\n"
        p += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/cli/\">cli</a> · <span class=\"step\">agents</span>"
              f"for coding agents</p>\n")
        p += f"  <h1>{esc(heading)}</h1>\n" + bodyhtml
        p += errors_list(folder, types) + notes_list(folder, types)
        nav = [f"{'next' if j > i else 'previous'}: <a href=\"/dewfpga/agents/{f}/\">{esc(h)}</a>"
               for j, (f, h, _) in enumerate(parts) if j != i]
        line = commands_line(body, types, "this page", own=folder)
        if line:
            nav.append(line)
        nav.append(f"From <a href=\"{GITHUB}/blob/main/docs/agent-interface.md\">docs/agent-interface.md</a>")
        p += "<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "</p>\n"
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/cli/">the cli</a> · <a href="/dewfpga/">home</a>', script=COPY_ALL)
        write(SITE / "agents" / folder / "index.html", p)
        written.append((SITE / "agents" / folder / "index.html", title, heading, desc))
    return f"site/agents: {len(parts)} pages"


def cmd_blocks(cmd, origin, md, types):
    """the blocks of one source that name a command; a list of commands (every line `dewfpga ...`)
    gives only its lines for this command; a table, only its header and this command's row"""
    out = []
    for kind, b in md_blocks(md):
        lines = [l for l in b.split("\n") if l.strip() and not l.startswith("```")]
        if kind == "head":
            continue
        if kind == "code" and lines and all(l.startswith(("dewfpga ", " ")) for l in lines):
            hit = [l for l in lines if l.startswith("dewfpga ") and cmd in cmd_words(l[len("dewfpga "):])]
            if hit:
                out.append(("code", "```\n" + "\n".join(hit) + "\n```"))
            continue
        if kind == "table" and origin == "agent":
            rows = [l for l in lines[2:] if re.match(r"^\|\s*`" + re.escape(cmd) + r"`\s*\|", l)]
            if rows:
                out.append(("table", "\n".join(lines[:2] + rows)))
            continue
        if cmd_re(cmd).search(b) or (cmd == "run" and origin == "readme" and re.search(r"\bRun\b", b)):
            out.append((kind, b))
    return out


def build_cli(types, written):
    helps, lines, cmds = cli_help(), cli_lines(), [c for c in cli_cmds(types) if c not in ("json", "mcp")]
    readme, agent = Path("README.md").read_text(), Path("docs/agent-interface.md").read_text()
    secs = guide_sections()
    for i, cmd in enumerate(cmds):
        url = f"{HOST}cli/{cmd}/"
        one = lines.get(cmd) or re.split(r"\s{2,}", helps[cmd].split("\n")[0].strip(), maxsplit=1)[-1]
        title = f"dewfpga {cmd}: {one}"
        rb = cmd_blocks(cmd, "readme", readme, types)
        gb = [(n, b) for n in secs for b in cmd_blocks(cmd, "guide", secs[n][2], types)]
        ab = cmd_blocks(cmd, "agent", agent, types)
        own = words(helps[cmd]) + sum(words(b) for _, b in rb + ab) + sum(words(b[1]) for _, b in gb)
        if own < THIN:
            sys.exit(f"cli: dewfpga {cmd} has {own} words of its own text; name it in CLI_NO_PAGE or give it more")
        p_body = "<h2 id=\"help\">What does its help text say?</h2>\n"
        p_body += f"<pre><code>{esc(helps[cmd], quote=False)}</code></pre>\n"
        p_body += f"<p class=\"mute small\">From <code>dewfpga --help</code>, as <a href=\"{GITHUB}/blob/main/bin/dewfpga\">bin/dewfpga</a> prints it.</p>\n"
        if rb:
            p_body += "<h2 id=\"readme\">What does the README say?</h2>\n"
            p_body += pandoc(link_md("\n\n".join(b for _, b in rb), "readme", types))
            p_body += f"<p class=\"mute small\">From <a href=\"{GITHUB}#readme\">the README</a>.</p>\n"
        if gb:
            p_body += "<h2 id=\"guide\">What does the guide say?</h2>\n"
            for n in dict.fromkeys(n for n, _ in gb):
                p_body += pandoc(link_md("\n\n".join(b for m, b in gb if m == n), "guide", types))
                ids = guide_ids()
                p_body += (f"<p class=\"mute small\">From section {n}, <a href=\"{guide_link(ids[n], types)}\">"
                           f"{esc(secs[n][1])}</a>.</p>\n")
        if ab:
            p_body += "<h2 id=\"agents\">How does a coding agent call it?</h2>\n"
            p_body += pandoc(link_md("\n\n".join(b for _, b in ab), "agent", types))
            if "agents" in types:
                p_body += ("<p class=\"mute small\">From the agent interface: <a href=\"/dewfpga/agents/json/\">the machine-readable CLI</a>"
                           " and <a href=\"/dewfpga/agents/mcp/\">the MCP server</a>.</p>\n")
        p_body += errors_list(cmd, types) + notes_list(cmd, types)
        p_body = p_body.replace('<pre class="copy"><code>', '<pre data-copy="1"><code>')
        firsts = [plain(m) for m in re.findall(r"<p>(.*?)</p>", p_body, re.S)[:1]]
        desc = summary(f"dewfpga {cmd}: {one}. " + (firsts[0] if firsts else ""))
        p = head(title, desc, url, "c-cli", article(f"dewfpga {cmd}", url))
        p += "<main class=\"wrap docs\">\n"
        p += f"  <p class=\"eyebrow\"><a href=\"/dewfpga/cli/\">cli</a> · <span class=\"step\">{esc(cmd)}</span>{esc(one)}</p>\n"
        p += f"  <h1>dewfpga {esc(cmd)}</h1>\n" + p_body
        nav = []
        if i:
            nav.append(f"previous: <a href=\"/dewfpga/cli/{cmds[i - 1]}/\">dewfpga {esc(cmds[i - 1])}</a>")
        if i + 1 < len(cmds):
            nav.append(f"next: <a href=\"/dewfpga/cli/{cmds[i + 1]}/\">dewfpga {esc(cmds[i + 1])}</a>")
        nav.append("Every command: " + " · ".join(f"<a href=\"{cmd_href(c)}\"><code>{esc(cmd_label(c))}</code></a>" for c in cli_cmds(types)))
        p += "<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "</p>\n"
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/cli/">the cli</a> · <a href="/dewfpga/">home</a>', script=COPY_ALL)
        write(SITE / "cli" / cmd / "index.html", p)
        written.append((SITE / "cli" / cmd / "index.html", title, f"dewfpga {cmd}", desc))
    return f"site/cli: {len(cmds)} command pages (none for {', '.join(CLI_NO_PAGE)})"


CLI_HUB_BEGIN, CLI_HUB_END = "<!-- command pages (docs/pages-build.py) -->\n", "<!-- /command pages -->\n"


def cli_hub(types):
    """the cli page links every command page, between two markers under its command list"""
    path = SITE / "cli/index.html"
    page = path.read_text()
    cs = cli_cmds(types)
    block = (CLI_HUB_BEGIN + "  <p class=\"mute small\">On their own pages: "
             + " · ".join(f"<a href=\"{cmd_href(c)}\"><code>{esc(cmd_label(c))}</code></a>" for c in cs) + ".</p>\n"
             + CLI_HUB_END) if cs else ""
    if CLI_HUB_BEGIN in page:
        i, j = page.index(CLI_HUB_BEGIN), page.index(CLI_HUB_END) + len(CLI_HUB_END)
        page = page[:i] + block + page[j:]
    elif block:
        anchor = "  </details>\n"
        if page.count(anchor) != 1:
            sys.exit("site/cli/index.html: no single '  </details>' to put the command links under")
        page = page.replace(anchor, anchor + block)
    write(path, page)


# ---------------------------------------------------------------- checks

def check(written):
    bad = []
    for i, label in ((1, "title"), (2, "h1"), (3, "description")):
        seen = {}
        for w in written:
            seen.setdefault(w[i], []).append(str(w[0]))
        bad += [f"same {label} on {' '.join(v)}: {k[:80]!r}" for k, v in seen.items() if len(v) > 1]
    for f, *_ in written:
        for href in re.findall(r'href="(/dewfpga/[^"]*)"', f.read_text()):
            path, _, frag = href[len("/dewfpga/"):].partition("#")
            rel = path + "index.html" if path.endswith("/") or path == "" else path
            target = next((r / rel for r in (SITE, Path(".")) if (r / rel).is_file()), None)
            if target is None or (frag and f'id="{frag}"' not in target.read_text()):
                bad.append(f"{f}: {href} does not resolve")
    if bad:
        sys.exit("pages-build:\n  " + "\n  ".join(bad))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default=",".join(TYPES))
    ap.add_argument("--check", action="store_true",
                    help="exit 1 and name the probe pages that differ from test/sv (test/site-check.py; no pandoc needed)")
    a = ap.parse_args()
    if a.check:
        global STALE
        STALE = []
        build_sv(set(TYPES), [])
        for f in STALE:
            print(f"{f}: differs from test/sv/expect.tsv or its probe; run python3 docs/pages-build.py")
        print(f"pages-build --check: {len(probes()) + 1} probe pages, {len(STALE)} differ")
        sys.exit(1 if STALE else 0)
    types = set(a.only.split(","))
    if not types <= {"sv", "notes", "guide", "agents", "cli"}:
        sys.exit("--only takes sv, notes, guide, agents, cli")
    written, said = [], []
    if "notes" in types:
        said.append(build_notes(types, written))
    if "guide" in types:
        said.append(build_guide(types, written))
        guide_contents()
    if "agents" in types:
        said.append(build_agents(types, written))
    if "cli" in types:
        said.append(build_cli(types, written))
    cli_hub(types)
    if "sv" in types:
        said.append(build_sv(types, written))
    check(written)
    print("\n".join(said))
    print(f"pages-build: {len(written)} pages; titles, h1s and descriptions unique; every /dewfpga/ href resolves")
    subprocess.run([sys.executable, "docs/nav.py"], check=True)


if __name__ == "__main__":
    main()
