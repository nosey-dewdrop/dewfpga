#!/usr/bin/env python3
"""Fault-injection checks for regressions the site validator previously missed."""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def check(site):
    return subprocess.run([sys.executable, str(ROOT / "test/site-check.py"),
                           "--site", str(site), "-q"], cwd=ROOT,
                          capture_output=True, text=True)


def main():
    mutations = [
        ("missing nav", lambda s: re.sub(r'<nav\b.*?</nav>', '', s, count=1, flags=re.S), 'missing site navigation'),
        ("missing local anchor", lambda s: s.replace('</body>', '<a href="#missing-fixture-id">broken</a></body>'), 'no id "missing-fixture-id"'),
        ("missing cross-page anchor", lambda s: s.replace('</body>', '<a href="../#missing-fixture-id">broken</a></body>'), 'no id "missing-fixture-id"'),
        ("duplicate id", lambda s: s.replace('</body>', '<p id="fixture-id"></p><p id="fixture-id"></p></body>'), 'duplicate id "fixture-id"'),
        ("question in title", lambda s: re.sub(r'<title>.*?</title>', '<title>Why should this exist</title>', s), '<title> question'),
        ("question in summary", lambda s: s.replace('</body>', '<details><summary>Why does this fail</summary></details></body>'), '<summary> question'),
        ("question in definition", lambda s: s.replace('</body>', '<dl><dt>Could I skip Vivado</dt><dd>No.</dd></dl></body>'), '<dt> question'),
        ("Turkish question", lambda s: s.replace('</body>', '<h2>Kart lazım mı</h2></body>'), '<h2> question'),
        ("missing canonical", lambda s: re.sub(r'<link rel="canonical"[^>]*>', '', s), '0 canonical links'),
    ]
    with tempfile.TemporaryDirectory(prefix="dewfpga-site-check-") as tmp:
        site = Path(tmp) / "site"
        shutil.copytree(ROOT / "site", site)
        baseline = check(site)
        assert baseline.returncode == 0, baseline.stdout + baseline.stderr
        page = site / "cli/index.html"
        original = page.read_text()
        for name, mutate, expected in mutations:
            changed = mutate(original)
            assert changed != original, f"fixture did not change: {name}"
            page.write_text(changed)
            result = check(site)
            assert result.returncode == 1 and expected in result.stdout, f"{name}: {result.stdout}{result.stderr}"
            page.write_text(original)
        sitemap = site / "sitemap.xml"
        sitemap.write_text(re.sub(r'<url>\s*<loc>[^<]*/cli/</loc>.*?</url>', '', sitemap.read_text(), flags=re.S))
        result = check(site)
        assert result.returncode == 1 and 'is not listed' in result.stdout, result.stdout
    print(f"PASS: clean site and {len(mutations) + 1} independently broken site fixtures")


if __name__ == "__main__":
    main()
