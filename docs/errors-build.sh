#!/usr/bin/env bash
# docs/errors.md -> site/errors/index.html + site/errors/<code>/index.html. Run after editing
# the catalog; the output is committed. Needs pandoc and python3. Idempotent: a second run
# changes no byte.
#
# What docs/errors.md holds, and what an entry must contain
# ---------------------------------------------------------
# The file starts with the index page: a `# ` heading (the h1 of site/errors/index.html), then
# `title:` and `description:` lines (its <title> and meta description), then one paragraph
# (the lead). Everything else before the first entry is printed under the list of codes, as it
# is (the "Your error is not here?" section).
#
# One entry per code. An entry starts with a `## ` heading whose text is the code alone:
# lowercase letters, digits and hyphens, nothing else (`## board-not-found`). The code is the
# folder: site/errors/<code>/index.html. A `## ` heading with anything else in it (`## Why does
# it happen?`) is a sub-heading inside the entry, not a new entry. Right under the code heading,
# without a blank line, `key: value` lines:
#   step:        where in the guide, or the CLI stage: 3.2, 4, flash, bit, sim, check
#   source:      the tool and the moment, e.g. "openFPGALoader, when you program the board"
#   title:       what the student sees, word for word: the line the terminal printed
#                (for a CLI code: "<file>:<line>: ERROR [<code>]: <message>")
#   summary:     one sentence: the cause. The index shows "<source>. <summary>" under the title.
#   date:        YYYY-MM-DD, the first build of the page (datePublished)
#   description: optional; the meta description. Default: "<summary> How to fix it when
#                building the open-source FPGA chain for a Basys3 on an Apple Silicon Mac."
#   og-title:    optional; the og:title. Default: "<title> (fix, macOS)", also the <title>.
# Then a blank line and the body, GitHub-flavoured markdown, in this order:
#   1. what the student saw: the command and the stage, then the printed lines in a plain
#      fenced block (```), word for word from a run
#   2. `## Why does it happen?`   the real cause
#   3. `## What is the fix?`      what to change; the fixed line or command in a ```copy block
#      (a ```copy fence gets the site's copy button, a plain ``` fence is output to read)
#   4. optional `## What should you see?`, and the link to the guide section
# A numbered list whose items start in bold (**The power switch.** ...) is styled as the
# board-not-found checklist (ol.walls, b). A raw <p class="mute small"> paragraph is passed
# through as it is. An HTML comment anywhere in the file is dropped before parsing, so a
# template for the next entry can sit in one. Every headline is a question and ends with "?".
set -euo pipefail
cd "$(dirname "$0")/.."
command -v pandoc >/dev/null || { echo "pandoc not found"; exit 1; }
python3 - <<'PY'
import html, json, re, subprocess, pathlib, sys

SRC = pathlib.Path("docs/errors.md")
OUT = pathlib.Path("site/errors")
BASE = "https://nosey-dewdrop.github.io/dewfpga/errors/"
CODE_RE = re.compile(r"^## ([a-z0-9][a-z0-9-]*)\s*$")

text = re.sub(r"<!--.*?-->\n?", "", SRC.read_text(), flags=re.S)
lines = text.split("\n")

def pandoc(md):
    out = subprocess.run(["pandoc", "-f", "gfm", "-t", "html5", "--wrap=none", "--syntax-highlighting=none"],
                         input=md, text=True, capture_output=True, check=True).stdout
    out = out.replace('<pre class="copy"><code>', '<pre data-copy="1"><code>')
    out = re.sub(r'<ol type="1">\n<li><strong>', '<ol class="walls">\n<li><strong>', out)
    out = out.replace("<strong>", "<b>").replace("</strong>", "</b>")
    return out.strip("\n") + "\n"

def meta_block(ls, i):
    """key: value lines from ls[i] until a blank line"""
    m = {}
    while i < len(ls) and ls[i].strip():
        k, _, v = ls[i].partition(":")
        if not _:
            sys.exit(f"docs/errors.md: not a 'key: value' line: {ls[i]!r}")
        m[k.strip()] = v.strip()
        i += 1
    return m, i

# split: preamble + entries
starts = [i for i, l in enumerate(lines) if CODE_RE.match(l)]
if not starts:
    sys.exit("docs/errors.md: no entry")
pre = lines[:starts[0]]
entries = []
for n, s in enumerate(starts):
    e = starts[n + 1] if n + 1 < len(starts) else len(lines)
    code = CODE_RE.match(lines[s]).group(1)
    m, i = meta_block(lines, s + 1)
    for k in ("step", "source", "title", "summary", "date"):
        if k not in m:
            sys.exit(f"docs/errors.md: entry {code} lacks '{k}:'")
    body = "\n".join(lines[i:e]).strip("\n") + "\n"
    entries.append((code, m, body))

# preamble: h1, meta, lead paragraph, the rest
if not pre or not pre[0].startswith("# "):
    sys.exit("docs/errors.md: the file must start with '# <heading>'")
h1 = pre[0][2:].strip()
im, i = meta_block(pre, 1)
while i < len(pre) and not pre[i].strip():
    i += 1
j = i
while j < len(pre) and pre[j].strip():
    j += 1
lead = " ".join(l.strip() for l in pre[i:j])
rest = "\n".join(pre[j:]).strip("\n") + "\n"

# the nav comes from one source, docs/nav.py
sys.dont_write_bytecode = True
sys.path.insert(0, "docs")
from nav import render
NAV = render("en", "c-err")
ICON = """<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90' fill='%235b2fc9'%3E%E2%9C%B3%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/dewfpga/s.css">
<script defer src="/dewfpga/s.js"></script>
"""

def head(title, desc, ogtitle, url, ld=None):
    esc = html.escape
    s = ("<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
         "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n"
         f"<title>{esc(title)}</title>\n"
         f"<meta name=\"description\" content=\"{esc(desc)}\">\n"
         f"<link rel=\"canonical\" href=\"{url}\">\n"
         "<meta property=\"og:type\" content=\"article\">\n"
         f"<meta property=\"og:title\" content=\"{esc(ogtitle)}\">\n"
         f"<meta property=\"og:description\" content=\"{esc(desc)}\">\n"
         f"<meta property=\"og:url\" content=\"{url}\">\n"
         "<meta property=\"og:image\" content=\"https://nosey-dewdrop.github.io/dewfpga/og.png\">\n"
         "<meta name=\"twitter:card\" content=\"summary_large_image\">\n" + ICON)
    if ld:
        s += "<script type=\"application/ld+json\">" + json.dumps(ld, ensure_ascii=False, separators=(",", ":")) + "</script>\n"
    return s + "</head>\n<body>\n" + NAV + "\n"

FOOT = """
<footer class="wrap">
  <span>Damla Su Bilge · MIT · <a href="https://github.com/nosey-dewdrop/dewfpga">source</a> · <a href="https://www.linkedin.com/in/damla-su-bilge-278841278/">linkedin</a></span>
  <span><a href="{back}">{label}</a></span>
</footer>
</body>
</html>
"""

SUFFIX = " How to fix it when building the open-source FPGA chain for a Basys3 on an Apple Silicon Mac."
written = []
for code, m, body in entries:
    url = BASE + code + "/"
    title = m["title"]
    desc = m.get("description") or m["summary"] + SUFFIX
    ogtitle = m.get("og-title") or title + " (fix, macOS)"
    ld = {"@context": "https://schema.org", "@type": "TechArticle", "headline": title, "url": url,
          "author": {"@type": "Person", "name": "Damla Su Bilge"}, "datePublished": m["date"], "inLanguage": "en"}
    page = head(title + " (fix, macOS)", desc, ogtitle, url, ld)
    page += "<main class=\"wrap\">\n"
    page += (f"  <p class=\"eyebrow\"><a href=\"/dewfpga/errors/\">errors</a> · "
             f"<span class=\"step\">{html.escape(m['step'])}</span>{html.escape(m['source'])}</p>\n")
    page += f"  <h1 class=\"mono\">{html.escape(title)}</h1>\n"
    page += pandoc(body)
    page += "</main>\n" + FOOT.format(back="/dewfpga/errors/", label="all errors")
    d = OUT / code
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.html").write_text(page)
    written.append(code)

# the index
page = head(im["title"], im["description"], im["title"], BASE)
page += "<main class=\"wrap\">\n"
page += f"  <h1>{html.escape(h1)}</h1>\n"
page += "  <p class=\"lead\">" + pandoc(lead).strip()[3:-4] + "</p>\n\n"
for code, m, _ in entries:
    page += ("  <div class=\"err\">\n"
             f"    <span class=\"step\">{html.escape(m['step'])}</span>"
             f"<a class=\"title\" href=\"/dewfpga/errors/{code}/\">{html.escape(m['title'])}</a>\n"
             f"    <p>{html.escape(m['source'] + '. ' + m['summary'])}</p>\n"
             "  </div>\n")
page += pandoc(rest)
page += "</main>\n" + FOOT.format(back="/dewfpga/", label="home")
(OUT / "index.html").write_text(page)

stale = sorted(p.name for p in OUT.iterdir() if p.is_dir() and p.name not in written)
print(f"site/errors: {len(written)} codes + index" + (f"; folders without an entry: {' '.join(stale)}" if stale else ""))

# every site link in the pages just written must resolve in the site tree (file, and anchor).
# CI serves site/ as the root and copies templates/ and sim/dist (built from sim/) next to it.
bad = []
for f in sorted(OUT.rglob("index.html")):
    for href in re.findall(r'href="(/dewfpga/[^"]*)"', f.read_text()):
        path, _, frag = href[len("/dewfpga/"):].partition("#")
        rel = path + "index.html" if path.endswith("/") or path == "" else path
        target = next((r / rel for r in (pathlib.Path("site"), pathlib.Path(".")) if (r / rel).is_file()), None)
        if target is None or (frag and f'id="{frag}"' not in target.read_text()):
            bad.append(f"{f}: {href}")
if bad:
    sys.exit("links that do not resolve:\n  " + "\n  ".join(bad))
print("links: every /dewfpga/ href in site/errors resolves")
PY
python3 docs/sitemap-build.py
