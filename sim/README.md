# sim — cs223 without vivado, the website

four static pages, built with vite. nothing runs on a server.

- `index.html` simulator: yosys (webassembly, `@yowasp/yosys`) synthesizes design.sv in a worker, `yosys2digitaljs` + `digitaljs` simulate the netlist, `src/sim/board.js` draws the basys3 and maps ports through the xdc (`src/sim/xdc.js`, pin table generated from `blink/Basys3_Master.xdc`).
- `tb.html` testbench: icarus verilog compiled to webassembly (`src/tb/wasm/`, built from `~/fpga/iverilog-wasm`, patches and build script there). `$display` output plus a vcd waveform viewer (`src/tb/vcd.js`, `src/tb/wave.js`).
- `cli.html` the mac command-line chain (mac-fpga installer).
- `docs.html` how it works, accepted systemverilog, xdc, limits, faq.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/  (66 mb yosys core is copied in, that is expected)
npm run preview    # http://localhost:4173, then: node test/e2e.mjs && node test/e2e-tb.mjs
```

tests drive a real chromium (playwright; the executable path in test/*.mjs points at the cached build).
`test/e2e.mjs`: switch → led, blink toggles, three button presses → `0003` on the display, error path, tab pages.
`test/e2e-tb.mjs`: three testbenches compile and run, waveform has rows, syntax error is reported, a testbench without `$finish` is stopped after 30 s.

## notes

- the simulator defines `SIM` (yosys `-DSIM`, iverilog `-DSIM`) so designs can pick a small clock divider for simulation.
- `src/sim/engine.js` settles pending input changes before raising the clock; without that a button press and the clock edge land in the same event tick and the flip-flop samples the old value.
- yosys script uses `memory` (not `memory -nomap`): digitaljs' memory cell did not update an async rom read in our test, mapped logic does.
- `src/tb/wasm/*.mjs` are the emscripten outputs with one edit: `getMemoryBuffer()` returns `wasmMemory.buffer` instead of `toResizableBuffer()`, because chrome's TextDecoder refuses views over resizable buffers ("The provided ArrayBuffer value must not be resizable").
- canonical urls point at `https://nosey-dewdrop.github.io/cs223/`; change them in the four html files, `public/sitemap.xml`, `public/robots.txt` if the site lives elsewhere.
