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
TYPES = ["sv", "notes", "guide"]  # what a plain run builds
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
        elif heading in NOTE_SLUGS:
            parts = heading.split(" · ")
            title = parts[1] if len(parts) == 3 else heading.split(": ", 1)[1]
            date = parts[2] if len(parts) == 3 else ""
            out.append((NOTE_SLUGS[heading], None, heading, title[0].upper() + title[1:], date, body))
    return out


def note_pages():
    return [n for n in notes() if n[1] not in NOTES_LEFT_OUT and words(n[5]) >= THIN]


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
    with_page = {n for _, n, *_ in note_pages() if n} if "notes" in types else set()

    def note_link(n, label):
        if n in with_page:
            return f'<a href="/dewfpga/patch-notes/{n}/">{label}</a>'
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
    keys = [k for k, *_ in pages]
    for i, (key, num, heading, title, date, body) in enumerate(pages):
        url = f"{HOST}patch-notes/{key}/"
        ptitle = plain(pandoc(title))
        label = f"#{num}" if num else heading.split(":")[0].split(" · ")[0].lower()
        page_title = (f"{label} {ptitle}" if num else ptitle) + ": dewfpga patch notes"
        text = plain(pandoc(body, "gfm-tex_math_dollars-raw_html"))
        desc = summary(text)
        h1 = f"{label} · {ptitle}" if num else ptitle
        p = head(page_title, desc, url, "c-notes", article(h1, url))
        p += "<main class=\"wrap docs\">\n"
        p += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/patch-notes/\">patch notes</a> · <span class=\"step\">{esc(label)}</span>"
              f"{esc(date)}</p>\n")
        h1_html = pandoc(title).strip()[3:-4]
        p += f"  <h1>{(esc(label) + ' · ') if num else ''}{h1_html}</h1>\n"
        p += pandoc(body, "gfm-tex_math_dollars-raw_html")
        nav = []
        if i:
            pk, pn, _, pt, *_ = pages[i - 1]
            nav.append(f"previous: <a href=\"/dewfpga/patch-notes/{pk}/\">{('#' + str(pn) + ' ') if pn else ''}{esc(plain(pandoc(pt)))}</a>")
        if i + 1 < len(pages):
            nk, nn, _, nt, *_ = pages[i + 1]
            nav.append(f"next: <a href=\"/dewfpga/patch-notes/{nk}/\">{('#' + str(nn) + ' ') if nn else ''}{esc(plain(pandoc(nt)))}</a>")
        where = f"/dewfpga/patch-notes/#{num}" if num else "/dewfpga/patch-notes/"
        p += ("<hr>\n<p class=\"mute small\">" + "<br>\n".join(nav) + "<br>\n"
              f"<a href=\"{where}\">This entry in the full list</a>"
              + ("<br>\nEvery SystemVerilog construct measured so far, next to what Vivado does: <a href=\"/dewfpga/sv/\">the probes, stage by stage</a>" if "sv" in types else "")
              + "</p>\n")
        p += "</main>\n" + FOOT.format(links='<a href="/dewfpga/patch-notes/">all patch notes</a> · <a href="/dewfpga/">home</a>', script=COPY_ALL)
        write(note_folder(key), p)
        written.append((note_folder(key), page_title, plain(h1), desc))
    stale = sorted(d.name for d in (SITE / "patch-notes").iterdir() if d.is_dir() and d.name not in {str(k) for k in keys})
    left = [n for _, n, *_ in notes() if n in NOTES_LEFT_OUT]
    thin = [k for k, n, _, _, _, b in notes() if n not in NOTES_LEFT_OUT and words(b) < THIN]
    return (f"site/patch-notes: {len(pages)} entry pages; left out {len(left)} (the CLI, its install, agents, mail), "
            f"{len(thin)} under {THIN} words: {' '.join('#' + str(t) for t in thin)}" + (f"; folders without an entry: {' '.join(stale)}" if stale else ""))


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
    if not types <= {"sv", "notes", "guide"}:
        sys.exit("--only takes sv, notes, guide")
    written, said = [], []
    if "notes" in types:
        said.append(build_notes(types, written))
    if "guide" in types:
        said.append(build_guide(types, written))
        guide_contents()
    if "sv" in types:
        said.append(build_sv(types, written))
    check(written)
    print("\n".join(said))
    print(f"pages-build: {len(written)} pages; titles, h1s and descriptions unique; every /dewfpga/ href resolves")
    subprocess.run([sys.executable, "docs/nav.py"], check=True)


if __name__ == "__main__":
    main()
