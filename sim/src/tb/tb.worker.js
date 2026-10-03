import { wrapKeywords } from '../sim/yosys-pipeline.js';
import { blank } from '../sim/project.js';
import { writeFiles, includeDirs } from '../sim/vfs.js';
// icarus verilog (iverilog + vvp) as webassembly, off the main thread.
import createIverilog from './wasm/iverilog.mjs';
import createVvp from './wasm/vvp.mjs';

self.onmessage = async ({ data }) => {
  const { id, files, extra = {}, top, compileOnly = false } = data;
  const log = [];
  const t0 = performance.now();
  try {
    const iv = await createIverilog({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    iv.FS.mkdir('/work');
    const names = [];
    const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const inputs = Object.fromEntries(Object.entries({ ...extra, ...files }).map(([n, t]) => [n, clean(t)]));
    for (const name of Object.keys(files)) if (/\.v$/i.test(name)) inputs[name] = wrapKeywords(name, inputs[name]);
    writeFiles(iv.FS, inputs);
    iv.FS.chdir('/work');
    names.push(...Object.keys(files).sort((a, b) => Number(/\bpackage\s+[A-Za-z_]/.test(blank(files[b]))) - Number(/\bpackage\s+[A-Za-z_]/.test(blank(files[a]))) || a.localeCompare(b, 'en')));
    const args = ['-g2012', '-DSIM', ...includeDirs(Object.keys(inputs)).flatMap(d => ['-I', d]), '-o', '/work/out.vvp'];
    if (top) args.push('-s', top);
    const rc = iv.callMain([...args, ...names]);
    if (rc !== 0) { self.postMessage({ id, ok: false, stage: 'compile', log }); return; }
    const vvpText = iv.FS.readFile('/work/out.vvp', { encoding: 'utf8' });
    const tCompile = performance.now() - t0;
    // live diagnostics only need iverilog's verdict; never start vvp for a lint request
    if (compileOnly) { self.postMessage({ id, ok: true, stage: 'compile-only', log, msCompile: Math.round(tCompile) }); return; }
    const out = [];
    const vv = await createVvp({ print: (s) => out.push(s), printErr: (s) => out.push(s) });
    vv.FS.mkdir('/work');
    vv.FS.chdir('/work');
    writeFiles(vv.FS, inputs);
    vv.FS.writeFile('/work/out.vvp', vvpText);
    const t1 = performance.now();
    const rc2 = vv.callMain(['-n', '/work/out.vvp']);
    const reportedErrors = out.filter(s => /^(ERROR|FATAL):/.test(s));
    const code = rc2 !== 0 ? 'sim-exit' : reportedErrors.length ? 'testbench-error' : null;
    if (code) log.push(`ERROR [${code}]: ${rc2 !== 0 ? `simulation exited with status ${rc2}` : `testbench reported ${reportedErrors.length} error(s)`}. Fix: read the first ERROR/FATAL line in the output and correct that check. https://nosey-dewdrop.github.io/dewfpga/errors/${code}/`);
    // $dumpfile("anything.vcd") may land in / or /work depending on how it was written
    let vcd = null;
    for (const dir of ['/work', '/']) {
      let entries = [];
      try { entries = vv.FS.readdir(dir); } catch { continue; }
      const f = entries.find((n) => /\.vcd$/i.test(n));
      if (f) { try { vcd = vv.FS.readFile(`${dir === '/' ? '' : dir}/${f}`, { encoding: 'utf8' }); break; } catch { /* keep looking */ } }
    }
    self.postMessage({ id, ok: code === null, code, stage: 'run', log, out, vcd, msCompile: Math.round(tCompile), msRun: Math.round(performance.now() - t1) });
  } catch (err) {
    self.postMessage({ id, ok: false, stage: 'crash', log: [...log, String(err && err.message || err)] });
  }
};
