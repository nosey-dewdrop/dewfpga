# Icarus Verilog (iverilog + vvp) as WebAssembly

Built 2026-09-19 from https://github.com/steveicarus/iverilog `v13-branch` (commit 07dd50d)
with Emscripten 6.0.2 (Homebrew `/opt/homebrew/bin/emcc`) on macOS arm64, Node 26.5.

## Files

| file | size | what |
|---|---|---|
| `iverilog.mjs` | 70,577 B | ES module, `export default createIverilog` |
| `iverilog.wasm` | 1,855,111 B | driver + ivlpp + ivl + tgt-vvp + vpi tables, one binary (includes embedded `/usr/local/lib/ivl/{vvp.conf,vvp-s.conf,include/*.vams}`) |
| `vvp.mjs` | 66,641 B | ES module, `export default createVvp` |
| `vvp.wasm` | 962,344 B | vvp runtime with system.vpi, v2005_math, v2009, va_math, vhdl_sys, vhdl_textio, vpi_debug linked in |
| `patches/0001-*.patch` | | all source changes (apply with `git apply` in the iverilog checkout) |
| `build.sh` | | the exact build, start to finish |
| `run-node-test.mjs` | | acceptance test; `node run-node-test.mjs` |
| `test-output.txt` | | its output |

Not gzipped. Both wasm files are -O2, no debug info.

## JS calling sequence

There is no exec in wasm, so the `iverilog` driver, `ivlpp` and `ivl` are linked into ONE module and
the driver's `system("ivlpp ... | ivl ...")` is dispatched in-process. You call the driver exactly like
the native `iverilog` command; you do not have to call ivlpp/ivl yourself. Then a second module runs vvp.

```js
import createIverilog from './iverilog.mjs';
import createVvp from './vvp.mjs';

// 1. compile: iverilog -g2012 -o /work/out.vvp /work/tb.sv
const iv = await createIverilog({ print: console.log, printErr: console.error });
iv.FS.mkdir('/work');
iv.FS.writeFile('/work/tb.sv', sourceText);           // any number of files; -I, -D, -s, -P etc. work
const rc1 = iv.callMain(['-g2012', '-o', '/work/out.vvp', '/work/tb.sv']);
const vvpText = iv.FS.readFile('/work/out.vvp', { encoding: 'utf8' });   // only if rc1 === 0

// 2. run: vvp /work/out.vvp
const vv = await createVvp({ print: console.log, printErr: console.error });
vv.FS.mkdir('/work');
vv.FS.writeFile('/work/out.vvp', vvpText);
const rc2 = vv.callMain(['/work/out.vvp']);            // plusargs go after the file, e.g. '+foo=1'
const vcd = vv.FS.readFile('/work/wave.vcd', { encoding: 'utf8' });     // if the tb did $dumpfile("/work/wave.vcd")
```

Each module instance is single-use (`EXIT_RUNTIME=1`; `callMain` runs `exit()`); create a fresh instance per
compile/run. Instantiation costs ~10-30 ms in Node. Use `$dumpfile` with an absolute MEMFS path; relative
paths land in `/` (cwd). The `print`/`printErr` callbacks get one line each; `$display` goes to `print`.

What the driver actually runs internally (from `iverilog -v`):
```
/usr/local/lib/ivl/ivlpp -L -F"/tmp/ivrlg2XXXX" -f"/tmp/ivrlgXXXX" -p"/tmp/ivrliXXXX" | /usr/local/lib/ivl/ivl -C"/tmp/ivrlhXXXX" -C"/usr/local/lib/ivl/vvp.conf" -- -
```
The `|` is emulated with a temp file plus `freopen(stdin)`; `ivl` then loads `vvp.tgt` and `system.vpi`
etc. through a static name table instead of `dlopen`.

## Build commands that worked

See `build.sh` (it is the literal sequence). Summary:

```sh
brew install autoconf automake            # bison flex gperf were already in /usr/bin
git clone --depth 1 --branch v13-branch https://github.com/steveicarus/iverilog src
cd src && git apply ../dist/patches/0001-iverilog-wasm-static-modules-inprocess-exec.patch
sh autoconf.sh
emconfigure ./configure --prefix=/usr/local --host=wasm32-unknown-emscripten
emmake make -j4 -k CFLAGS=-O2 CXXFLAGS="-O2 -std=c++11" LDFLAGS= ivl      # objects only, link fails (expected)
emmake make -j4 -k -C tgt-vvp ...; -C vpi ...; -C vvp ...                  # same
emmake make -j4 -k -C driver CPPFLAGS='$(INCLUDE_PATH) -DHAVE_CONFIG_H -Dverbose_flag=drv_verbose_flag ...'   # symbol renames
emmake make -j4 -k -C ivlpp  CPPFLAGS='$(INCLUDE_PATH) -DHAVE_CONFIG_H -Dverbose_flag=pp_verbose_flag ...'
em++ -c -O2 -DIVL_STATIC_TARGETS -I. wasm/ivl_static_modules.cc -o wasm/ivl_static_modules_ivl.o
em++ -c -O2 -I. wasm/ivl_static_modules.cc -o wasm/ivl_static_modules_vvp.o
emcc -c -O2 wasm/ivl_wasm_system.c -o wasm/ivl_wasm_system.o
FLAGS="-O2 -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
       -sFORCE_FILESYSTEM=1 -sEXIT_RUNTIME=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sSTACK_SIZE=8388608"
em++ $FLAGS -sEXPORT_NAME=createVvp -o vvp.mjs vvp/*.o vpi/*.o wasm/ivl_static_modules_vvp.o
em++ $FLAGS -sEXPORT_NAME=createIverilog --embed-file ../lib/ivl@/usr/local/lib/ivl -o iverilog.mjs \
     driver/*.o ivlpp/*.o *.o tgt-vvp/*.o vpi/*.o wasm/ivl_static_modules_ivl.o wasm/ivl_wasm_system.o
```
Full compile of all objects: about 6 minutes at -j4. The Makefile's own link steps and `version.exe`
(a host tool) fail; that is why every make is `-k` and the links are done by hand.

## Patches (all under `#if defined(__EMSCRIPTEN__)`, native build unchanged)

1. `ivl_dlfcn.h` — `ivl_dlopen/ivl_dlsym/dlerror` route to `ivl_static_dlopen/…` (new `wasm/ivl_static_modules.cc`):
   a table `{module basename, symbol, pointer}` covering `vvp.tgt: target_design/target_query` (ivl only,
   `-DIVL_STATIC_TARGETS`) and `<name>.vpi: vlog_startup_routines`.
2. `vpi/*.c` — each module's `vlog_startup_routines[]` is renamed `vlog_startup_routines_<module>` so seven
   modules can live in one binary.
3. `vvp/vpi_modules.cc` — skip the `stat()` search for `.vpi` files; pass the bare name to the static resolver.
4. `driver/main.c` — `system()` -> `ivl_wasm_system()` (new `wasm/ivl_wasm_system.c`): tokenises the shell line
   (quotes, `|`, `>`), turns `> file`/pipe into `-o file`, `freopen`s stdin on the pipe temp file, resets
   `optind`, calls `ivlpp_main`/`ivl_main`, returns a wait(2)-style status.
5. `ivlpp/main.c`, `main.cc` — `main` renamed `ivlpp_main` / `ivl_main` (extern "C").
6. `pform.cc` — `popen(ivlpp …)` (used by ivl to preprocess library files and the main input when
   `ivlpp:` is in the config) -> `ivl_wasm_system` into a temp file + `fopen`.

Additionally, at compile time, `-D` renames for globals that clash between driver/ivlpp/ivl
(`verbose_flag`, `COPYRIGHT`, `NOTICE`, `destroy_lexor`, `vhdlpp_*`, `integer_width`, `width_cap`,
`ignore_missing_modules`, `depend_file`, `error_count`) — see `build.sh`.

## Test output (`node run-node-test.mjs`)

```
PASS iverilog compile rc=0
  vvp> hello 42
  vvp> q done
  vvp> /work/tb.sv:2: $finish called at 75 (1s)
PASS vvp rc=0
PASS output contains "hello 42"
PASS output contains "q done"
PASS iverilog compile (vcd) rc=0
PASS VCD read back from MEMFS (475 bytes)
PASS VCD declares q[3:0]
PASS VCD has timestamps up to end of sim

ALL TESTS PASSED
```

Also verified once (test/run-vcd.mjs in the work dir): two-file compile (`tb2.sv counter.sv`), `` `include ``
with `-I`, `$clog2`, `$fopen/$fwrite` to MEMFS, `$dumpvars(0, tbv)` -> 163-line VCD; 30 ms compile, 12 ms sim.

## Known problems / not verified

- **`-y <dir>` library search hangs** (>150 s, killed) in the iverilog module. Cause not investigated
  (suspect: the driver/ivl directory scan or the `ivlpp:` popen path being re-entered per library file).
  Workaround: pass all files explicitly on the command line. DOĞRULANMADI which layer hangs.
- **Long simulations not timed.** A 1,000,000-cycle testbench was started in wasm and did not finish inside
  the 300 s test window (the native vvp run was in the same window, so no comparison number exists).
  Expect wasm to be several times slower than native; test with the sizes you actually need.
- `-tvhdl`, `-tvlog95`, `-tnull`, etc. are not linked; only `-tvvp` (default). Adding a target = add its objects
  and a table row in `wasm/ivl_static_modules.cc`.
- `vhdlpp` (VHDL front end) is not built; `iverilog` will report an error if given `.vhd` files.
- User `.vpi` plugins cannot be loaded (no dlopen).
- `sys_lxt/lxt2/fst` dumpers: not built (`--with-lxt` not configured); `$dumpfile` = VCD only.
- Browser run not executed here (only Node). The flags include `web,worker`, and nothing Node-specific is used,
  but this is DOĞRULANMADI.
- Prior-art search (YoWASP, verilog playgrounds) was started in a background agent and its result was not
  used; this build is from first principles.
