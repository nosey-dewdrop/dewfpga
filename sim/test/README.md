# Browser and site checks

From `sim/`, install the locked dependencies and Playwright's matching browser:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm test
```

On Linux, use `npx playwright install --with-deps chromium` to install browser system
dependencies too. CI uses Node 22 on Ubuntu. `npm test` builds the simulator, starts
a preview on a free local port, runs the real browser checks, then closes the preview.
An assertion failure returns a nonzero status. The default timeout is 15 minutes;
set `E2E_TIMEOUT` in milliseconds to change it. On macOS and Linux a timeout also
terminates browser descendants still attached to the test process.

`E2E_OUT` selects the screenshot directory. `BROWSER` may be `chromium`, `webkit`, or
`firefox` when the matching browser is installed. `E2E_EXECUTABLE` is an optional
explicit executable override; the default uses Playwright's managed browser.
`BASE` is only needed when running `node test/e2e.mjs` against an existing server.

From the repository root:

```sh
python3 test/site-check-test.py
python3 test/site-check.py
python3 test/site-check.py --bundle out
# After rewriting the bundle for the mirror's root URL:
python3 test/site-check.py --bundle out --prefix /
```

The first command verifies the checker against a clean site and deliberately broken
copies, including a removed navigation bar, missing anchors, duplicate IDs, missing
metadata and unpunctuated questions. Question detection is a language heuristic,
not a general grammar checker. Source checking uses tracked site files; links to
generated downloads and simulator assets are checked in bundle mode.

Regenerate `site/sitemap.xml` with `python3 docs/sitemap-build.py` after adding and
staging an indexable page. The documentation generators run this step themselves.
Pages deployment depends on both the macOS CLI job and the Ubuntu browser job;
the assembled artifact must pass the bundle check before upload.
