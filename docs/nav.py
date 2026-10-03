#!/usr/bin/env python3
"""The site's navigation, from one source.

The nav strip appears on every page: the hand-written pages under site/, the guide
(site/docs, built by docs/build.sh from docs/site.tmpl), the error catalog (site/errors,
built by docs/errors-build.sh) and the simulator (sim/index.html). Its markup is the table
below, its CSS is docs/nav.css. This script writes both into every copy:

  python3 docs/nav.py          rewrite every <nav class="top"> and both stylesheets
  python3 docs/nav.py --check  exit 1 and name the copies that differ (test/site-check.py)

Idempotent: a second run changes no byte. docs/errors-build.sh imports render() instead of
keeping its own copy. The markup per page: the English pages link the brand to /dewfpga/,
the Turkish page to /dewfpga/tr/ with hreflang="en" on the chips (they lead to English
pages); a page inside a section carries aria-current="page" on that section's chip, the
home, 404, guide, Turkish and simulator pages carry none. Changing which page marks which
chip is a change here, not in a page.

The CSS lands between the two "nav (generated)" marker comments in site/s.css and
sim/src/style.css; the text between them is overwritten, the files around it are not."""
import glob, os, re, sys

CHIPS = [  # class, href, label (en), label (tr)
    ("c-why", "/dewfpga/why/", "why", "neden"),
    ("c-err", "/dewfpga/errors/", "errors", "hatalar"),
    ("c-github", "https://github.com/nosey-dewdrop/dewfpga", "github", "github"),
    ("c-cli", "/dewfpga/cli/", "cli", "cli"),
    ("c-docs", "/dewfpga/docs/", "docs", "rehber"),
    ("c-sim", "/dewfpga/sim/", "simulator", "simülatör"),
]
BRAND = {"en": "/dewfpga/", "tr": "/dewfpga/tr/"}

# page -> (language, active chip). site/errors/**/index.html is added below.
PAGES = {
    "site/index.html": ("en", None),
    "site/404.html": ("en", None),
    "site/why/index.html": ("en", "c-why"),
    "site/cli/index.html": ("en", "c-cli"),
    "site/docs/index.html": ("en", None),
    "site/tr/index.html": ("tr", None),
    "sim/index.html": ("en", None),
}
CSS_FILES = ["site/s.css", "sim/src/style.css"]
CSS_BEGIN = "/* ---------- nav (generated) ----------\n   Copied from docs/nav.css by docs/nav.py. Edit docs/nav.css, run python3 docs/nav.py;\n   a change made here is overwritten. */\n"
CSS_END = "/* ---------- /nav (generated) ---------- */\n"
NAV_RE = re.compile(r'<nav class="top" aria-label="Site">.*?</nav>\n', re.S)


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


def pages():
    p = dict(PAGES)
    for f in sorted(glob.glob("site/errors/**/index.html", recursive=True)):
        p[f] = ("en", "c-err")
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
    return NAV_RE.sub(lambda m: render(lang, active), old, count=1)


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
