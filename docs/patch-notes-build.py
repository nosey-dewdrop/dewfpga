#!/usr/bin/env python3
"""docs/patch-notes.md -> site/patch-notes/index.html. Run after adding an entry; the output is committed.

Each `### #N · title · date` heading becomes <h3 id="N">, the newest entry also carries id="latest",
and an index of entries goes under the h1. The only date not written in the notes themselves is the
file's last commit date, read from git (dateModified); nothing is invented. Idempotent: a second run
writes the same bytes. Ends by running docs/nav.py (the nav stub) and docs/sitemap-build.py.
"""
import html, os, re, subprocess, sys

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC, OUT = "docs/patch-notes.md", "site/patch-notes/index.html"
URL = "https://nosey-dewdrop.github.io/dewfpga/patch-notes/"
TITLE = "What changed in dewfpga, and when? Patch notes"
DESC = ("Every update to dewfpga, numbered, with what the student saw before and after, what broke, "
        "what was measured and what was found and left. Generated from docs/patch-notes.md.")

body = subprocess.run(["pandoc", "-f", "gfm-tex_math_dollars-raw_html", "-t", "html5", "--syntax-highlighting=none", "--wrap=none", SRC],
                      check=True, capture_output=True, text=True).stdout
date = subprocess.run(["git", "log", "-1", "--format=%cs", "--", SRC], capture_output=True, text=True).stdout.strip()

# entries: <h3 id="…">#N · title · date</h3>  ->  id="N"
entries = []
def h3(m):
    text = re.sub(r"<[^>]+>", "", m.group(2))
    mm = re.match(r"#(\d+)\s*·\s*(.*)", html.unescape(text))
    if not mm: return m.group(0)
    n, rest = mm.group(1), mm.group(2)
    entries.append((int(n), rest))
    return f'<h3 id="{n}">{m.group(2)}</h3>'
body = re.sub(r'<h3 id="([^"]*)">(.*?)</h3>', h3, body)
if not entries: sys.exit("no `### #N · …` entries found in " + SRC)
latest = max(entries)[0]
body = body.replace(f'<h3 id="{latest}">', f'<span id="latest"></span>\n<h3 id="{latest}">', 1)

# the index of entries goes under the h1, newest first
items = "".join(f'<li><a href="#{n}">#{n}</a> {html.escape(rest)}</li>\n' for n, rest in sorted(entries, reverse=True))
index = (f'<p class="docbar"><span>{len(entries)} updates</span><a href="#latest">latest: #{latest}</a>'
         f'<a href="https://github.com/nosey-dewdrop/dewfpga/blob/main/docs/patch-notes.md">source</a></p>\n'
         f'<ul class="notes-index">\n{items}</ul>\n')
body = re.sub(r"(</h1>\n)", lambda m: m.group(1) + index, body, count=1)
date_meta = f',"dateModified":"{date}"' if date else ""

page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{TITLE}</title>
<meta name="description" content="{DESC}">
<link rel="canonical" href="{URL}">
<meta property="og:type" content="article">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESC}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="https://nosey-dewdrop.github.io/dewfpga/og.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90' fill='%235b2fc9'%3E%E2%9C%B3%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="/dewfpga/s.css">
<script defer src="/dewfpga/s.js"></script>
<script type="application/ld+json">
{{"@context":"https://schema.org","@type":"TechArticle","headline":"{TITLE}",
 "url":"{URL}","author":{{"@type":"Person","name":"Damla Su Bilge"}},"inLanguage":"en"{date_meta}}}
</script>
</head>
<body>
<nav class="top" aria-label="Site"><!-- filled by docs/nav.py --></nav>
<main class="wrap docs">
{body}<hr>
<p class="mute small">Stuck on an error? <a href="/dewfpga/errors/">Every error from this setup, filed under the exact line it printed.</a></p>
</main>
<footer class="wrap">
  <span>Damla Su Bilge · MIT · <a href="https://github.com/nosey-dewdrop/dewfpga">source</a> · <a href="https://www.linkedin.com/in/damla-su-bilge-278841278/">linkedin</a></span>
  <span><a href="/dewfpga/docs/">the guide</a> · <a href="/dewfpga/">home</a></span>
</footer>
<script>document.querySelectorAll("main pre").forEach(function(p){{p.setAttribute("data-copy","1")}})</script>
</body>
</html>
'''
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, "w").write(page)
print(f"{OUT}: {len(page.encode())} bytes, {len(entries)} entries, latest #{latest}, dateModified {date or 'none'}")
subprocess.run([sys.executable, "docs/nav.py"], check=True)
subprocess.run([sys.executable, "docs/sitemap-build.py"], check=True)
