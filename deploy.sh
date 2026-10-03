#!/usr/bin/env bash
# dewfpga -> Vercel (dewfpga.noseydewdrop.com). Same bundle CI publishes to GitHub Pages, served from the root:
# every root-relative "/dewfpga/..." path becomes "/...". Absolute https://nosey-dewdrop.github.io/dewfpga/ links
# (canonical, og, sitemap) are left alone. Needs: vercel CLI logged in, node, zip, pandoc-built site/docs.
#   ./deploy.sh            build out/ and deploy to production
#   ./deploy.sh --preview  build and deploy a preview url
set -euo pipefail
cd "$(dirname "$0")"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo 'deploy: commit the reviewed changes before publishing.' >&2
  exit 1
fi
# Vite copies public/ verbatim, including dotfiles. Refuse an untracked input before building.
# Do not use --exclude-standard: ignored files must be rejected too.
if [ -n "$(git ls-files --others -- sim/public)" ]; then
  echo 'deploy: untracked files in sim/public; move them out before publishing.' >&2
  exit 1
fi
OUT=out
rm -rf "$OUT"; mkdir -p "$OUT/templates/.vscode" "$OUT/sim"

# 1. the bundle, exactly as .github/workflows/ci.yml assembles it
python3 scripts/package.py >/dev/null
# only files git tracks: an untracked file in site/ (tool state, a stale sim build, a secret) never reaches the mirror
git ls-files -z site | tar -cf - --null -T - | tar -xf - -C "$OUT" --strip-components 1
mv dewfpga-*.tgz "$OUT/dewfpga.tgz" && (cd "$OUT" && shasum -a 256 dewfpga.tgz > dewfpga.tgz.sha256)
git ls-files -z templates | tar -cf - --null -T - | tar -xf - -C "$OUT"   # templates/ and templates/.vscode/, tracked files only
(cd templates && zip -q "../$OUT/blink.zip" blink.sv blink_tb.sv blink.xdc check_xdc.py Makefile .vscode/tasks.json .vscode/settings.json .vscode/extensions.json)
(cd sim && npm run build --silent >/dev/null 2>&1)
cp -R sim/dist/. "$OUT/sim/"

# 2. root-relative paths: "/dewfpga/x" -> "/x" in text files (html, css, js, xml, txt, json, webmanifest)
find "$OUT" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.xml' -o -name '*.txt' -o -name '*.json' \) -print0 \
  | xargs -0 perl -pi -e 's{(?<=["'"'"'(=\s])/dewfpga/}{/}g'
# the sim's CSS references the nav strip with url(/dewfpga/art/nav.png) -> url(/art/nav.png): covered above.
python3 test/site-check.py --bundle "$OUT" --prefix /

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
# vercel link/deploy write a project id and a short-lived token (out/.vercel/, out/.env.local) next to the bundle.
# Removed on every exit from here on, success or failure (set -e would otherwise skip a trailing rm). Nothing else is touched.
trap 'rm -rf "$OUT/.vercel" "$OUT/.env.local"' EXIT
vercel link --cwd "$OUT" --yes --project dewfpga >/dev/null
vercel deploy --cwd "$OUT" --yes $mode 2>&1 | tail -3
