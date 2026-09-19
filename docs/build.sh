#!/usr/bin/env bash
# docs/manual-setup.md -> site/docs/index.html. Run after editing the guide; the output is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
DATE=$(git log -1 --format=%cs -- docs/manual-setup.md 2>/dev/null || date +%F)
pandoc -f gfm -t html5 --syntax-highlighting=none --wrap=none \
  --template docs/site.tmpl -V date="$DATE" \
  docs/manual-setup.md -o site/docs/index.html
# the docbar goes right under the h1
perl -0pi -e 's{(</h1>)}{$1\n<p class="docbar"><span>19 September 2026 · M2, 8 GB, macOS 15</span><a href="/dewfpga/docs/CS223_Mac_Setup.pdf">PDF, 13 pages</a><a href="/dewfpga/templates/Makefile">the five project files</a></p>}' site/docs/index.html
echo "site/docs/index.html: $(wc -c < site/docs/index.html) bytes"
