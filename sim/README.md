# sim — dewfpga in the browser: the basys3 simulator and the testbench runner

one static page, built with vite. nothing runs on a server.

- `index.html` one workspace with freely named source, header, memory and constraints files, two views:
  - **board**: yosys (webassembly, `@yowasp/yosys`) synthesizes the design in a worker, `yosys2digitaljs` + `digitaljs` simulate the netlist, `src/sim/board.js` draws the basys3 and maps ports through the xdc (`src/sim/xdc.js`, pin table generated from `Basys3_Master.xdc`).
  - **testbench**: icarus verilog compiled to webassembly (`src/tb/wasm/`; the build recipe and patches are in `src/tb/wasm/build/`) compiles everything including tb.sv. `$display` output plus a vcd waveform viewer (`src/tb/vcd.js`, `src/tb/wave.js`).
  - `?view=tb` opens the testbench view; switching views re-runs the active tool on the current files.
- `tb.html` redirects old links to `./?view=tb` and keeps their hash. old share links ({sv, xdc}, {files, tb}) still load.
- the `blink` example is imported verbatim from `templates/` (`?raw`), so `dewfpga new blink` and the browser show one file. `templates/blink.sv` uses `` `ifdef SIM `` for a watchable divider.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/  (66 mb yosys core is copied in, that is expected)
npm run preview    # http://localhost:4173, then: node test/e2e.mjs   (BASE=http://localhost:4199/ for another port)
```

`npm test` builds once, then runs source/workspace checks and real browser UI, original
engine regressions, board interaction and WASM worker checks. Chromium is the default;
use `BROWSER=webkit npm test` for WebKit. Install the selected Playwright browser first
(`npx playwright install chromium` or `npx playwright install webkit`). CI runs both.
`E2E_OUT` selects the screenshot directory. `test/README.md` describes the test scope.

`node test/probe-behavior.mjs` and `node test/engine-isolation.mjs` additionally require
native Yosys and Icarus: they test actual browser worker netlists under their original
testbenches and compare outputs in DigitalJS. macOS CI runs them. The 133-case
`test/probe-decisions.mjs` audit compares compilation decisions only; it does not prove
behavioral equivalence, timing closure or physical board behavior.

Files can be opened as a folder or dropped into the workspace. A project tree keeps
relative paths; active Vivado source sets are read from an imported XPR. Multiple tops,
testbenches or constraints need an explicit choice when the resolver cannot select
one. The workspace saves edits locally; share links carry selections, roles and file
bytes, and ZIP export generates the CLI project manifest.

Live diagnostics show source locations in the editor and problems panel. Errors close
Run; a timed-out check is shown as unchecked and Run recompiles the source. The board
supports pointer and keyboard controls, source hover links and timing advice for slow
counters. The Max setting remains a browser simulation speed, not a 100 MHz promise.

## notes

- the simulator defines `SIM` (yosys `-DSIM`, iverilog `-DSIM`) so designs can pick a small clock divider for simulation.
- `src/sim/engine.js` settles pending input changes before raising the clock; without that a button press and the clock edge land in the same event tick and the flip-flop samples the old value.
- yosys script uses `memory` (not `memory -nomap`): digitaljs' memory cell did not update an async rom read in our test, mapped logic does.
- `src/tb/wasm/*.mjs` are the emscripten outputs with one edit: `getMemoryBuffer()` returns `wasmMemory.buffer` instead of `toResizableBuffer()`, because chrome's TextDecoder refuses views over resizable buffers ("The provided ArrayBuffer value must not be resizable").
- canonical and og urls point at `https://nosey-dewdrop.github.io/dewfpga/sim/`; change them in `index.html` if the site lives elsewhere.
