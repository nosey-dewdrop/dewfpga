# Browser and site checks

From `sim/`, install the locked dependencies and Playwright's matching browser:

```sh
npm ci --ignore-scripts
npx playwright install chromium webkit
npm test
```

On Linux, use `npx playwright install --with-deps chromium webkit` to install browser system
dependencies too. CI uses Node 22 on Ubuntu with separate Chromium and WebKit jobs. WebKit automation does not replace manual Safari or physical-phone acceptance. `npm test` builds the simulator, starts
a preview on a free local port, runs the UI, board and actual WASM-worker checks, then closes the preview. Source-scan and workspace checks run first.
An assertion failure returns a nonzero status. The default timeout is 15 minutes;
set `E2E_TIMEOUT` in milliseconds to change the total browser-suite deadline. On macOS and Linux a timeout also
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
not a general grammar checker. Source checking uses tracked site files and the simulator source page's publication metadata; links to
generated downloads and simulator assets are checked in bundle mode.

Regenerate `site/sitemap.xml` with `python3 docs/sitemap-build.py` after adding and
staging an indexable page. The documentation generators run this step themselves.
Pages deployment depends on both the macOS CLI job and the Ubuntu browser job;
the assembled artifact must pass the bundle check before upload.

The focused worker serialization regression is run from the repository root with
`node sim/test/probe-behavior.mjs`. It needs native `yosys`, `iverilog`, and `vvp`
on PATH in addition to the browser dependencies above. It compiles the interface,
package, and hierarchical-reference fixtures through the actual browser worker,
runs its serialized JSON netlists under the original testbenches, and checks 576
output vectors in DigitalJS itself. `OUT` optionally retains the netlists and
testbench logs. This is a three-design regression, not whole-corpus equivalence.

Run `BROWSER=webkit npm test` for the WebKit suite locally. Both browser jobs include
board input/hover and hardware-validation regressions; a passing UI-only suite is
not sufficient. The macOS CI job also checks serialized worker netlists with native
Yosys and Icarus, using `probe-behavior.mjs`.

The five original UI regressions in `sim17-evidence.mjs` are assertions in the
normal browser suite. `engine-isolation.mjs` additionally needs native Yosys and
Icarus: it checks wrapper filename collisions and library-reader isolation with
exported netlists and actual DigitalJS outputs. The macOS CI job runs it too.
