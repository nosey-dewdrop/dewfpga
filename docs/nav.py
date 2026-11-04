#!/usr/bin/env python3
"""The site's navigation and footer, from one source.

The nav strip and the footer appear on every page: the hand-written pages under site/, the
guide (site/docs, built by docs/build.sh from docs/site.tmpl), the error catalog (site/errors,
built by docs/errors-build.sh), the pages docs/pages-build.py writes, the home pages (built by
docs/home/build.py) and the simulator (sim/index.html, nav only: its footer carries the
licence notices). Their markup is below, their CSS is docs/nav.css. This script writes both
into every copy:

  python3 docs/nav.py          rewrite every <nav class="top">, every <footer class="wrap"> and both stylesheets
  python3 docs/nav.py --check  exit 1 and name the copies that differ (test/site-check.py)

Idempotent: a second run changes no byte. docs/errors-build.sh and docs/pages-build.py import
render() and footer() instead of keeping their own copies. The nav per page: the wordmark and
five links, cli, docs, errors, simulator, github. The English pages link the wordmark to
/dewfpga/, the Turkish page to /dewfpga/tr/ with hreflang="en" on the links (they lead to
English pages); a page inside a section carries aria-current="page" on that section's link.
The footer: who built it, the licence, linkedin, then why, patch notes and the other language.
Changing which page marks which link is a change here, not in a page.

The CSS lands between the two "nav (generated)" marker comments in site/s.css and
sim/src/style.css; the text between them is overwritten, the files around it are not."""
import glob, os, re, sys

CHIPS = [  # class, href, label (en), label (tr)
    ("c-cli", "/dewfpga/cli/", "cli", "cli"),
    ("c-docs", "/dewfpga/docs/", "docs", "rehber"),
    ("c-err", "/dewfpga/errors/", "errors", "hatalar"),
    ("c-sim", "/dewfpga/sim/", "simulator", "simülatör"),
    ("c-github", "https://github.com/nosey-dewdrop/dewfpga", "github", "github"),
]
# the footer's second half: the pages the nav leaves out, and the other language
MORE = {
    "en": [("/dewfpga/why/", "why", None), ("/dewfpga/patch-notes/", "patch notes", None), ("/dewfpga/tr/", "türkçe", "tr")],
    "tr": [("/dewfpga/why/", "neden", "en"), ("/dewfpga/patch-notes/", "yama notları", "en"), ("/dewfpga/", "english", "en")],
}
BUILT = {"en": "built by damla su bilge", "tr": "yapan damla su bilge"}
LINKEDIN = "https://www.linkedin.com/in/damla-su-bilge-278841278/"
BRAND = {"en": "/dewfpga/", "tr": "/dewfpga/tr/"}

# page -> (language, active chip). site/errors/**/index.html and the pages docs/pages-build.py writes are added below.
PAGES = {
    "site/index.html": ("en", None),
    "site/404.html": ("en", None),
    "site/why/index.html": ("en", None),
    "site/cli/index.html": ("en", "c-cli"),
    "site/docs/index.html": ("en", "c-docs"),
    "site/patch-notes/index.html": ("en", None),
    "site/account/index.html": ("en", None),
    "site/privacy/index.html": ("en", None),
    "site/newsletter/index.html": ("en", None),
    "site/newsletter/confirm/index.html": ("en", None),
    "site/newsletter/unsubscribe/index.html": ("en", None),
    "site/tr/index.html": ("tr", None),
    "sim/index.html": ("en", None),
}
CSS_FILES = ["site/s.css", "sim/src/style.css"]
CSS_BEGIN = "/* ---------- nav (generated) ----------\n   Copied from docs/nav.css by docs/nav.py. Edit docs/nav.css, run python3 docs/nav.py;\n   a change made here is overwritten. */\n"
CSS_END = "/* ---------- /nav (generated) ---------- */\n"
NAV_RE = re.compile(r'<nav class="top" aria-label="Site">.*?</nav>\n', re.S)
FOOT_RE = re.compile(r'<footer class="wrap">.*?</footer>\n', re.S)


def render(lang="en", active=None):
    """The nav markup for one page, exactly as the pages carry it."""
    if lang not in BRAND:
        raise ValueError(f"unknown language {lang!r}")
    if active is not None and active not in {c[0] for c in CHIPS}:
        raise ValueError(f"unknown chip {active!r}")
    out = ['<nav class="top" aria-label="Site">', f'  <a class="brand" href="{BRAND[lang]}">dewfpga</a>']
    for cls, href, en, tr in CHIPS:
        attrs = f'class="{cls}" href="{href}"'
        if lang == "tr":
            attrs += ' hreflang="en"'
        if cls == active:
            attrs += ' aria-current="page"'
        out.append(f"  <a {attrs}>{tr if lang == 'tr' else en}</a>")
    out.append("</nav>")
    return "\n".join(out) + "\n"


def footer(lang="en"):
    """The footer markup for one page, exactly as the pages carry it."""
    if lang not in BRAND:
        raise ValueError(f"unknown language {lang!r}")
    more = "".join(f'<a href="{h}"' + (f' hreflang="{hl}"' if hl else "") + f">{t}</a>" for h, t, hl in MORE[lang])
    return ('<footer class="wrap">\n'
            f'  <span>{BUILT[lang]} · mit · <a href="{LINKEDIN}">linkedin</a></span>\n'
            f'  <span class="more">{more}</span>\n'
            "</footer>\n")


def pages():
    p = dict(PAGES)
    for f in sorted(glob.glob("site/errors/**/index.html", recursive=True)):
        p[f] = ("en", "c-err")
    # docs/pages-build.py: the probes, one page per patch note, one per guide section
    for f in sorted(glob.glob("site/sv/**/index.html", recursive=True)):
        p[f] = ("en", None)
    for f in sorted(glob.glob("site/patch-notes/*/index.html")):
        p[f] = ("en", None)
    for f in sorted(glob.glob("site/docs/*/index.html")):
        p[f] = ("en", "c-docs")
    for f in sorted(glob.glob("site/cli/*/index.html") + glob.glob("site/agents/*/index.html")):
        p[f] = ("en", "c-cli")
    return p


def css_block():
    with open("docs/nav.css", encoding="utf-8") as f:
        return CSS_BEGIN + f.read() + CSS_END


def new_text(path, old):
    """What the file should hold; None when the file has no nav to fill."""
    if path in CSS_FILES:
        i, j = old.find(CSS_BEGIN), old.find(CSS_END)
        if i < 0 or j < i:
            sys.exit(f"{path}: the nav (generated) markers are missing or out of order")
        return old[:i] + css_block() + old[j + len(CSS_END):]
    lang, active = pages()[path]
    if not NAV_RE.search(old):
        sys.exit(f'{path}: no <nav class="top" aria-label="Site"> ... </nav> to fill')
    out = NAV_RE.sub(lambda m: render(lang, active), old, count=1)
    # the simulator keeps its own footer: it carries the licence notices
    return FOOT_RE.sub(lambda m: footer(lang), out, count=1)


def main(argv):
    check = argv[1:] == ["--check"]
    if argv[1:] and not check:
        sys.exit(__doc__)
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    changed = []
    for path in list(pages()) + CSS_FILES:
        if not os.path.exists(path):
            if path in CSS_FILES or path in PAGES:
                sys.exit(f"{path}: missing")
            continue
        with open(path, encoding="utf-8", newline="") as f:
            old = f.read()
        new = new_text(path, old)
        if new != old:
            changed.append(path)
            if not check:
                with open(path, "w", encoding="utf-8", newline="") as f:
                    f.write(new)
    if check:
        for p in changed:
            print(f"{p}: differs from docs/nav.py; run python3 docs/nav.py")
        print(f"nav: {len(pages()) + len(CSS_FILES)} copies, {len(changed)} differ")
        return 1 if changed else 0
    print(f"nav: {len(pages()) + len(CSS_FILES)} copies, {len(changed)} rewritten")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
