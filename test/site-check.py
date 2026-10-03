#!/usr/bin/env python3
"""site check: links, anchors, canonical, sitemap, nav copies, question headings, private files. stdlib only.

  test/site-check.py                      source mode: site/ as git tracks it; links into bundle-made files
                                          (dewfpga.tgz, templates/, blink.zip, sim/) are deferred, not skipped silently
  test/site-check.py --bundle out         bundle mode: the assembled bundle, canonical prefix /dewfpga/ (GitHub Pages);
                                          every link must resolve, dewfpga.tgz must hold only files git tracks
  test/site-check.py --bundle out --prefix /   the mirror (served from the root): no root-relative /dewfpga/ may remain

exit 0 = no failures. one line per failure: `file: what`. warnings do not fail.
"""
import argparse, io, os, re, subprocess, sys, tarfile, zipfile
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

CANON_HOST = 'https://nosey-dewdrop.github.io'
CANON_PREFIX = '/dewfpga/'
# files the bundle makes (deploy.sh / ci.yml); in source mode a link to one of these is a deferred link, not a miss
BUNDLE_MADE = ['dewfpga.tgz', 'dewfpga.tgz.sha256', 'blink.zip', 'templates/', 'sim/']
TEXT_EXT = ('.html', '.css', '.js', '.xml', '.txt', '.json')
LINK_ATTRS = {('a', 'href'), ('link', 'href'), ('script', 'src'), ('img', 'src'), ('form', 'action'),
              ('source', 'src'), ('iframe', 'src'), ('video', 'src'), ('audio', 'src')}
H_TAGS = {'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'summary', 'dt'}
EXTERNAL_HOSTS_SAME_SITE = ('nosey-dewdrop.github.io/dewfpga/',)

fails, warns = [], []
def fail(f, msg): fails.append(f'{f}: {msg}')
def warn(f, msg): warns.append(f'{f}: {msg}')


class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []      # (tag, attr, value, line)
        self.ids = set()
        self.duplicate_ids = []
        self.meta = {}       # canonical, og:url, og:image, robots
        self.hreflang = []   # (lang, href)
        self.headings = []   # (tag, text, line)
        self.nav = None      # list of (href, text) inside the first <nav>
        self._h = None
        self._in_nav = 0
        self._a = None
        self._title = None
        self.title = ''

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        line = self.getpos()[0]
        if 'id' in a:
            if a['id'] in self.ids: self.duplicate_ids.append((a['id'], line))
            self.ids.add(a['id'])
        if tag == 'a' and 'name' in a: self.ids.add(a['name'])
        for t, k in LINK_ATTRS:
            if tag == t and a.get(k) is not None:
                self.links.append((tag, k, a[k], line))
        if tag == 'link' and a.get('rel') == 'canonical':
            self.meta.setdefault('canonical', []).append(a.get('href', ''))
        if tag == 'link' and a.get('rel') == 'alternate' and a.get('hreflang'):
            self.hreflang.append((a['hreflang'], a.get('href', '')))
        if tag == 'meta':
            key = a.get('property') or a.get('name')
            if key in ('og:url', 'og:image', 'robots', 'twitter:image'):
                self.meta.setdefault(key, []).append(a.get('content', ''))
        if tag in H_TAGS: self._h = [tag, '', line]
        if tag == 'nav':
            self._in_nav += 1
            if self.nav is None: self.nav = []
        if tag == 'a' and self._in_nav and self.nav is not None: self._a = [a.get('href', ''), '']
        if tag == 'title': self._title = ''
        if tag == 'style': self._style = True

    def handle_endtag(self, tag):
        if tag in H_TAGS and self._h:
            self.headings.append((self._h[0], ' '.join(self._h[1].split()), self._h[2])); self._h = None
        if tag == 'nav' and self._in_nav: self._in_nav -= 1
        if tag == 'a' and self._a is not None:
            self.nav.append((self._a[0], ' '.join(self._a[1].split()))); self._a = None
        if tag == 'title' and self._title is not None: self.title = ' '.join(self._title.split()); self._title = None

    def handle_data(self, d):
        if self._h: self._h[1] += d
        if self._a is not None: self._a[1] += d
        if self._title is not None: self._title += d


def read(path):
    with open(path, 'rb') as f: return f.read().decode('utf-8', 'replace')


def site_files(root, bundle):
    """relative paths of the pages to check. source mode: git-tracked files under site/. bundle mode: everything in it."""
    if bundle:
        out = []
        for d, _, fs in os.walk(root):
            for f in fs: out.append(os.path.relpath(os.path.join(d, f), root))
        return sorted(out)
    ls = subprocess.run(['git', 'ls-files', '-z', '--', root], capture_output=True).stdout
    tracked = sorted(os.path.relpath(p, root) for p in ls.decode().split('\0') if p)
    if tracked: return tracked
    return site_files(root, True)      # an untracked copy of the site: check what is on disk


def resolve(target, from_rel, prefix, files, bundle):
    """map a link target to a site-relative path. returns (rel or None, kind): kind in local|external|skip|deferred|mirror-leak"""
    t = target.strip()
    if not t or t.startswith(('mailto:', 'tel:', 'data:', 'javascript:')): return None, 'skip'
    if t.startswith('#'): return from_rel, 'local'          # same-page link: the fragment is checked against this page's ids
    u = urlsplit(t)
    if u.scheme in ('http', 'https'):
        same = t.startswith(CANON_HOST + CANON_PREFIX)
        if not same: return None, 'external'
        path = u.path[len(CANON_PREFIX) - 1:]          # /dewfpga/x -> /x
    elif u.scheme: return None, 'skip'
    elif t.startswith('//'): return None, 'external'
    elif u.path.startswith('/'):
        if u.path.startswith(CANON_PREFIX) or u.path == CANON_PREFIX.rstrip('/'):
            if prefix == '/': return None, 'mirror-leak'   # the mirror rewrite missed this one
            path = u.path[len(CANON_PREFIX) - 1:]
        elif prefix == CANON_PREFIX:
            return None, 'outside-prefix'                  # /x on github pages is another repo's page
        else:
            path = u.path
    else:
        base = os.path.dirname(from_rel)
        path = os.path.normpath(os.path.join('/', base, u.path)) if u.path else '/' + from_rel
        if u.path.endswith('/') and not path.endswith('/'): path += '/'
    path = unquote(path).lstrip('/')
    if path == '' or path.endswith('/'): path += 'index.html'
    if path in files: return path, 'local'
    if not path.endswith('.html') and (path + '/index.html') in files:
        return path + '/index.html', 'dir-no-slash'
    if not bundle and any(path == b or path.startswith(b) for b in BUNDLE_MADE): return path, 'deferred'
    return path, 'missing'


def check_tgz(bundle_dir):
    """dewfpga.tgz holds only files git tracks and nothing gitignored or personal."""
    p = os.path.join(bundle_dir, 'dewfpga.tgz')
    if not os.path.exists(p): fail('dewfpga.tgz', 'missing from the bundle'); return
    names = []
    with tarfile.open(p) as t:
        for m in t.getmembers():
            if m.isdir(): continue
            n = m.name.split('/', 1)[1] if '/' in m.name else m.name   # strip package/
            names.append(n)
    tracked = set(subprocess.run(['git', 'ls-files', '-z'], capture_output=True, check=True).stdout.decode().split('\0'))
    for n in names:
        if n not in tracked: fail('dewfpga.tgz', f'{n} is not a git-tracked file')
    ign = subprocess.run(['git', 'check-ignore', '--no-index', '-z', '--stdin'], input='\0'.join(names).encode(), capture_output=True).stdout
    for n in ign.decode().split('\0'):
        if n: fail('dewfpga.tgz', f'{n} is gitignored')
    sha = os.path.join(bundle_dir, 'dewfpga.tgz.sha256')
    if not os.path.exists(sha): fail('dewfpga.tgz.sha256', 'missing from the bundle')
    else:
        import hashlib
        want = read(sha).split()[0]
        got = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        if want != got: fail('dewfpga.tgz.sha256', f'{want[:12]}… does not match dewfpga.tgz {got[:12]}…')
    z = os.path.join(bundle_dir, 'blink.zip')
    if not os.path.exists(z): fail('blink.zip', 'missing from the bundle')
    else:
        with zipfile.ZipFile(z) as zf: zn = set(zf.namelist())
        for need in ('blink.sv', 'blink_tb.sv', 'blink.xdc', 'check_xdc.py', 'Makefile', '.vscode/tasks.json'):
            if need not in zn: fail('blink.zip', f'{need} missing')
    return names


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--bundle', help='assembled bundle directory (out/); default: source mode on site/')
    ap.add_argument('--prefix', default=CANON_PREFIX, help='url prefix the bundle is served under: /dewfpga/ (default) or /')
    ap.add_argument('--site', default='site', help='source directory (source mode)')
    ap.add_argument('-q', '--quiet', action='store_true', help='print only failures')
    args = ap.parse_args()
    bundle = bool(args.bundle)
    root = args.bundle or args.site
    prefix = args.prefix if args.prefix.endswith('/') else args.prefix + '/'
    if bundle and prefix not in (CANON_PREFIX, '/'):
        sys.exit(f'--prefix must be {CANON_PREFIX} (github pages) or / (mirror)')
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(repo)
    files = set(site_files(root, bundle))
    home = os.path.expanduser('~')
    pages = {}
    for rel in sorted(files):
        if rel.endswith('.html'):
            p = Page(); p.feed(read(os.path.join(root, rel))); pages[rel] = p

    # 1. every link, src, css url() resolves; fragments exist on the target page
    n_links = 0
    for rel in sorted(files):
        path = os.path.join(root, rel)
        if rel.endswith('.html'):
            targets = [(v, f'line {ln} <{t} {k}>') for t, k, v, ln in pages[rel].links]
        elif rel.endswith('.css'):
            targets = [(m.group(1).strip('\'"'), 'url()') for m in re.finditer(r'url\(([^)]+)\)', read(path))]
        else: continue
        for target, where in targets:
            n_links += 1
            tgt, kind = resolve(target, rel, prefix, files, bundle)
            if kind in ('skip', 'external', 'deferred'): continue
            if kind == 'mirror-leak': fail(rel, f'{where} {target}: root-relative {CANON_PREFIX} left after the mirror rewrite'); continue
            if kind == 'outside-prefix': fail(rel, f'{where} {target}: root-relative path outside {CANON_PREFIX}'); continue
            if kind == 'missing': fail(rel, f'{where} {target}: no such file ({tgt})'); continue
            if kind == 'dir-no-slash': warn(rel, f'{where} {target}: directory link without trailing slash (one redirect on github pages)')
            frag = unquote(urlsplit(target).fragment)       # the browser decodes %C3%A7 before matching an id
            if frag and tgt.endswith('.html') and tgt in pages and frag not in pages[tgt].ids:
                fail(rel, f'{where} {target}: no id "{frag}" in {tgt}')
        if bundle and rel.endswith(TEXT_EXT) and prefix == '/':
            for m in re.finditer(r'(?<=["\'(=\s])/dewfpga/', read(path)):
                fail(rel, f'byte {m.start()}: root-relative /dewfpga/ left after the mirror rewrite')
        if rel.endswith(TEXT_EXT) and home in read(path): fail(rel, f'contains the personal path {home}')

    # 2. canonical, og:url, og:image, hreflang: absolute github.io urls that match the page's own path (both modes:
    #    the mirror keeps them pointing at the canonical host)
    indexable = {}
    for rel, p in sorted(pages.items()):
        own = CANON_HOST + CANON_PREFIX + (rel[:-len('index.html')] if rel.endswith('index.html') else rel)
        robots = ' '.join(p.meta.get('robots', []))
        canon = p.meta.get('canonical', [])
        if 'noindex' in robots:
            if canon and canon[0] != own: warn(rel, f'noindex page with canonical {canon[0]}')
            continue
        if len(canon) != 1: fail(rel, f'{len(canon)} canonical links (want 1)'); continue
        if canon[0] != own: fail(rel, f'canonical {canon[0]} is not {own}')
        indexable[own] = rel
        for key in ('og:url',):
            for v in p.meta.get(key, []):
                if v != own: fail(rel, f'{key} {v} is not {own}')
        for key in ('og:image', 'twitter:image'):
            for v in p.meta.get(key, []):
                if not v.startswith(CANON_HOST + CANON_PREFIX): fail(rel, f'{key} {v} is not absolute on {CANON_HOST}{CANON_PREFIX}'); continue
                img = v[len(CANON_HOST + CANON_PREFIX):]
                if img not in files: fail(rel, f'{key} {v}: no such file')
        if p.hreflang:
            langs = dict(p.hreflang)
            if 'x-default' not in langs: fail(rel, 'hreflang set without x-default')
            if own not in langs.values(): fail(rel, 'hreflang set does not include the page itself')
            for lang, href in p.hreflang:
                if not href.startswith(CANON_HOST + CANON_PREFIX): fail(rel, f'hreflang {lang} {href} is not absolute on the canonical host')
                elif href[len(CANON_HOST + CANON_PREFIX):] + 'index.html' not in files and href[len(CANON_HOST + CANON_PREFIX):] not in files:
                    fail(rel, f'hreflang {lang} {href}: no such page')
        if not p.title: fail(rel, 'no <title>')

    # 3. sitemap.xml: every url is an indexable page with that canonical; every indexable page is in the sitemap;
    #    robots.txt points at the sitemap under the canonical host
    sm = os.path.join(root, 'sitemap.xml')
    if not os.path.exists(sm): fail('sitemap.xml', 'missing')
    else:
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        try:
            locs = [e.text.strip() for e in ET.parse(sm).getroot().findall('s:url/s:loc', ns)]
        except ET.ParseError as e:
            locs = []; fail('sitemap.xml', f'not well-formed: {e}')
        seen = set()
        for loc in locs:
            if loc in seen: fail('sitemap.xml', f'{loc} listed twice')
            seen.add(loc)
            if not loc.startswith(CANON_HOST + CANON_PREFIX): fail('sitemap.xml', f'{loc} is not under {CANON_HOST}{CANON_PREFIX}'); continue
            relp = loc[len(CANON_HOST + CANON_PREFIX):]
            if loc in indexable: continue
            if relp in files and not relp.endswith('.html'): continue        # a file (the pdf) is fine
            target = relp + 'index.html' if relp.endswith('/') or relp == '' else relp
            if target in pages: fail('sitemap.xml', f'{loc} is noindex or its canonical differs')
            else: fail('sitemap.xml', f'{loc}: no such page')
        for own, rel in sorted(indexable.items()):
            if own not in seen: fail('sitemap.xml', f'indexable page {rel} ({own}) is not listed')
    rb = os.path.join(root, 'robots.txt')
    if not os.path.exists(rb): fail('robots.txt', 'missing')
    elif f'Sitemap: {CANON_HOST}{CANON_PREFIX}sitemap.xml' not in read(rb): fail('robots.txt', f'no "Sitemap: {CANON_HOST}{CANON_PREFIX}sitemap.xml" line')

    # 4. nav: every page in a language carries the same nav as that language's index
    navs = {}
    for rel, p in sorted(pages.items()):
        if p.nav is None:
            if rel != 'sim/tb.html': fail(rel, 'missing site navigation')
            continue
        lang = 'tr' if rel == 'tr/index.html' or rel.startswith('tr/') else 'en'
        key = tuple((urlsplit(h).path, t) for h, t in p.nav)
        navs.setdefault(lang, {}).setdefault(key, []).append(rel)
    for lang, groups in navs.items():
        if len(groups) > 1:
            ref = f'{"tr/" if lang == "tr" else ""}index.html'
            refkey = next((k for k, v in groups.items() if ref in v), max(groups, key=lambda k: len(groups[k])))
            for key, rels in groups.items():
                if key == refkey: continue
                diff = [f'{h} "{t}"' for h, t in key if (h, t) not in refkey]
                for r in rels: fail(r, f'nav differs from {ref}: {", ".join(diff) or "missing entries"}')

    # 4b. every nav copy matches the one source, docs/nav.py
    r = subprocess.run([sys.executable, 'docs/nav.py', '--check'], capture_output=True, text=True)
    if r.returncode != 0:
        fail('docs/nav.py', '--check: ' + (r.stdout + r.stderr).strip().replace('\n', '; '))

    # 5. headings: a heading in question form ends with "?"
    q_start = re.compile(r'^(why|how|what|which|who|when|where|is|are|do|does|did|can|could|should|would|will|has|have|was|were|neden|nasıl|ne|hangi|kim|ne zaman|nerede)\b', re.I)
    q_particle = re.compile(r'\b(mı|mi|mu|mü)(yım|yim|yum|yüm|sın|sin|sun|sün|yız|yiz|yuz|yüz|sınız|siniz|sunuz|sünüz|lar|ler)?\s*$', re.I)
    for rel, p in sorted(pages.items()):
        for ident, line in p.duplicate_ids:
            fail(rel, f'line {line} duplicate id "{ident}"')
        for tag, text, line in p.headings + [('title', p.title, 1)]:
            # A tab title may append a label after its question ("...? The guide").
            punctuated = '?' in text if tag == 'title' else text.rstrip().endswith('?')
            if (q_start.match(text) or q_particle.search(text)) and not punctuated:
                fail(rel, f'line {line} <{tag}> question heading without "?": "{text[:60]}"')

    # 6. bundle: nothing gitignored or private, the package holds only tracked files, bundle-made files are present
    if bundle:
        for need in ('dewfpga.tgz', 'dewfpga.tgz.sha256', 'blink.zip', 'sim/index.html', 'sim/tb.html', 'templates/Makefile', 'templates/check_xdc.py', 'templates/.vscode/tasks.json', 'install', 'index.html'):
            if need not in files: fail(need, 'missing from the bundle')
        for rel in sorted(files):
            if rel.startswith(('.vercel/', '.rabadon/', '.git/', '.claude/')) or rel in ('.env.local', '.DS_Store') or rel.endswith(('.pem', '.key')):
                fail(rel, 'private or tool file in the bundle')
        check_tgz(root)

    if not args.quiet:
        print(f'{root}: {len(pages)} pages, {len(files)} files, {n_links} links checked, prefix {prefix}, {"bundle" if bundle else "source"} mode')
        for w in warns: print(f'WARN {w}')
    for f in fails: print(f'FAIL {f}')
    bad = {f.split(': ', 1)[0] for f in fails}
    print(f'site-check: {len(pages) - len(bad & set(pages))} of {len(pages)} pages clean, {len(fails)} failures in {len(bad)} files')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
