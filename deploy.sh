#!/usr/bin/env bash
# dewfpga -> Vercel (dewfpga.noseydewdrop.com). Same bundle CI publishes to GitHub Pages, served from the root:
# every root-relative "/dewfpga/..." path becomes "/...". Absolute https://nosey-dewdrop.github.io/dewfpga/ links
# (canonical, og, sitemap) are left alone. Needs: vercel CLI logged in, node, zip, pandoc-built site/docs.
#   ./deploy.sh            build out/ and deploy to production
#   ./deploy.sh --preview  build and deploy a preview url
set -euo pipefail
cd "$(dirname "$0")"
OUT=out
rm -rf "$OUT"; mkdir -p "$OUT/templates/.vscode" "$OUT/sim"

# 1. the bundle, exactly as .github/workflows/ci.yml assembles it
npm pack --silent >/dev/null
cp -R site/. "$OUT/"
mv dewfpga-*.tgz "$OUT/dewfpga.tgz" && (cd "$OUT" && shasum -a 256 dewfpga.tgz > dewfpga.tgz.sha256)
cp templates/* "$OUT/templates/" && cp templates/.vscode/tasks.json "$OUT/templates/.vscode/"
(cd templates && zip -q "../$OUT/blink.zip" blink.sv blink_tb.sv blink.xdc check_xdc.py Makefile .vscode/tasks.json)
(cd sim && npm run build --silent >/dev/null 2>&1)
cp -R sim/dist/. "$OUT/sim/"

# 2. root-relative paths: "/dewfpga/x" -> "/x" in text files (html, css, js, xml, txt, json, webmanifest)
find "$OUT" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.xml' -o -name '*.txt' -o -name '*.json' \) -print0 \
  | xargs -0 perl -pi -e 's{(?<=["'"'"'(=\s])/dewfpga/}{/}g'
# the sim's CSS references the nav strip with url(/dewfpga/art/nav.png) -> url(/art/nav.png): covered above.

# 3. vercel config next to the files: the installer must be served as plain text, redirects for old tb links
cat > "$OUT/vercel.json" <<'JSON'
{
  "cleanUrls": false,
  "headers": [
    { "source": "/install", "headers": [ { "key": "Content-Type", "value": "text/plain; charset=utf-8" } ] },
    { "source": "/(.*)\\.wasm", "headers": [ { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" } ] },
    { "source": "/sim/assets/(.*)", "headers": [ { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" } ] }
  ]
}
JSON

# 4. deploy
mode=--prod; [ "${1:-}" = --preview ] && mode=
vercel link --cwd "$OUT" --yes --project dewfpga >/dev/null
vercel deploy --cwd "$OUT" --yes $mode 2>&1 | tail -3
