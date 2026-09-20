# sim — cs223 without vivado, the website

one static page, built with vite. nothing runs on a server.

- `index.html` one workspace, the same three files as the cli (design.sv + any other .sv, tb.sv, basys3.xdc), two views:
  - **board**: yosys (webassembly, `@yowasp/yosys`) synthesizes the design in a worker, `yosys2digitaljs` + `digitaljs` simulate the netlist, `src/sim/board.js` draws the basys3 and maps ports through the xdc (`src/sim/xdc.js`, pin table generated from `Basys3_Master.xdc`).
  - **testbench**: icarus verilog compiled to webassembly (`src/tb/wasm/`, built from `~/fpga/iverilog-wasm`, patches and build script there) compiles everything including tb.sv. `$display` output plus a vcd waveform viewer (`src/tb/vcd.js`, `src/tb/wave.js`).
  - `?view=tb` opens the testbench view; switching views re-runs the active tool on the current files.
- `tb.html` redirects old links to `./?view=tb` and keeps their hash. old share links ({sv, xdc}, {files, tb}) still load.
- the `blink` example is imported verbatim from `templates/` (`?raw`), so `dewfpga new blink` and the browser show one file. `templates/blink.sv` uses `` `ifdef SIM `` for a watchable divider.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/  (66 mb yosys core is copied in, that is expected)
npm run preview    # http://localhost:4173, then: node test/e2e.mjs   (BASE=http://localhost:4199/ for another port)
```

tests drive a real chromium (playwright; the executable path in test/*.mjs points at the cached build).
`test/e2e.mjs`, 31 checks: boot is the cli blink template, switch → led, blink toggles, the testbench view runs the
same files (`basic checks passed`, waveform), an edit reaches both tools, every example runs in both views, multi-file
design, iverilog and yosys errors land in the console, watchdog for a testbench without `$finish`, old `tb.html` links.

## notes

- the simulator defines `SIM` (yosys `-DSIM`, iverilog `-DSIM`) so designs can pick a small clock divider for simulation.
- `src/sim/engine.js` settles pending input changes before raising the clock; without that a button press and the clock edge land in the same event tick and the flip-flop samples the old value.
- yosys script uses `memory` (not `memory -nomap`): digitaljs' memory cell did not update an async rom read in our test, mapped logic does.
- `src/tb/wasm/*.mjs` are the emscripten outputs with one edit: `getMemoryBuffer()` returns `wasmMemory.buffer` instead of `toResizableBuffer()`, because chrome's TextDecoder refuses views over resizable buffers ("The provided ArrayBuffer value must not be resizable").
- canonical urls point at `https://nosey-dewdrop.github.io/cs223/`; change them in the four html files, `public/sitemap.xml`, `public/robots.txt` if the site lives elsewhere.
