#!/usr/bin/env bash
# site/docs/index.html -> site/docs/CS223_Mac_Setup.pdf. Plain white print, no nav, no copy buttons.
# Needs Google Chrome. Run after docs/build.sh; the output is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || { echo "Chrome not found, PDF not rebuilt"; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
{
  cat <<'CSS'
<!doctype html><meta charset="utf-8"><title>How do you run CS223 labs on a Mac without Vivado?</title>
<style>
 @page { size: A4; margin: 18mm 16mm; }
 body { font: 11pt/1.5 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; max-width: 100%; }
 h1 { font-size: 22pt; line-height: 1.2; margin: 0 0 4pt; } h2 { font-size: 15pt; margin: 22pt 0 6pt; page-break-after: avoid; }
 h3 { font-size: 12pt; margin: 14pt 0 4pt; }
 pre { background: #f4f4f4; border: 1px solid #ddd; padding: 8pt 10pt; font: 9pt/1.4 Menlo, monospace; white-space: pre-wrap; word-break: break-all; page-break-inside: avoid; }
 code { font: 9.5pt Menlo, monospace; } pre code { font-size: 9pt; }
 table { border-collapse: collapse; margin: 8pt 0; } th, td { text-align: left; vertical-align: top; padding: 4pt 8pt 4pt 0; border-bottom: 1px solid #ddd; }
 a { color: #333; } .docbar span, .docbar a { margin-right: 10pt; color: #555; font-size: 9.5pt; } hr { border: 0; border-top: 1px solid #ddd; margin: 14pt 0; }
 nav, footer, .mute { display: none; }
</style>
CSS
  sed -n '/<main class="wrap docs">/,/<\/main>/p' site/docs/index.html | sed '1d;$d' | sed 's#href="/dewfpga/#href="https://nosey-dewdrop.github.io/dewfpga/#g'
} > "$T/print.html"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$T/out.pdf" "file://$T/print.html" 2>/dev/null
cp "$T/out.pdf" site/docs/CS223_Mac_Setup.pdf
echo "site/docs/CS223_Mac_Setup.pdf: $(python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page[^s]',open(sys.argv[1],'rb').read())))" site/docs/CS223_Mac_Setup.pdf) pages"
