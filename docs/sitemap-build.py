#!/usr/bin/env python3
"""Rebuild the sitemap from canonical, indexable pages; preserve existing metadata."""
from html.parser import HTMLParser
from pathlib import Path
import xml.etree.ElementTree as ET
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
BASE = "https://nosey-dewdrop.github.io/dewfpga/"
ET.register_namespace("", NS)
ET.register_namespace("xhtml", "http://www.w3.org/1999/xhtml")


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonical = None
        self.noindex = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and a.get("rel") == "canonical":
            self.canonical = a.get("href")
        if tag == "meta" and a.get("name", "").lower() == "robots":
            self.noindex |= "noindex" in a.get("content", "").lower()


def main():
    path = SITE / "sitemap.xml"
    old = ET.parse(path).getroot()
    previous = {u.findtext(f"{{{NS}}}loc"): u for u in old}
    urls = set()
    tracked = subprocess.check_output(["git", "ls-files", "-z", "--", "site"], cwd=ROOT)
    pages = sorted(ROOT / p.decode() for p in tracked.split(b"\0") if p.endswith(b".html"))
    for page in pages:
        meta = Metadata()
        meta.feed(page.read_text())
        if meta.canonical and not meta.noindex:
            if not meta.canonical.startswith(BASE):
                raise SystemExit(f"{page.relative_to(ROOT)}: canonical outside {BASE}")
            urls.add(meta.canonical)
    # Keep downloadable documents already advertised by the sitemap.
    for url in previous:
        if url and url.startswith(BASE) and url.endswith(".pdf"):
            if (SITE / url[len(BASE):]).is_file():
                urls.add(url)
    result = ET.Element(f"{{{NS}}}urlset")
    for url in sorted(urls):
        entry = previous.get(url)
        if entry is None:
            entry = ET.Element(f"{{{NS}}}url")
            ET.SubElement(entry, f"{{{NS}}}loc").text = url
        result.append(entry)
    ET.indent(result, space="  ")
    path.write_bytes(ET.tostring(result, encoding="UTF-8", xml_declaration=True) + b"\n")
    print(f"site/sitemap.xml: {len(urls)} URLs")


if __name__ == "__main__":
    main()
