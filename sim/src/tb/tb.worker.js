// icarus verilog (iverilog + vvp) as webassembly, off the main thread.
import createIverilog from './wasm/iverilog.mjs';
import createVvp from './wasm/vvp.mjs';

self.onmessage = async ({ data }) => {
  const { id, files, top } = data;
  const log = [];
  const t0 = performance.now();
  try {
    const iv = await createIverilog({ print: (s) => log.push(s), printErr: (s) => log.push(s) });
    iv.FS.mkdir('/work');
    const names = [];
    const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    for (const [name, text] of Object.entries(files)) { iv.FS.writeFile('/work/' + name, clean(text)); names.push('/work/' + name); }
    const args = ['-g2012', '-DSIM', '-o', '/work/out.vvp'];
    if (top) args.push('-s', top);
    const rc = iv.callMain([...args, ...names]);
    if (rc !== 0) { self.postMessage({ id, ok: false, stage: 'compile', log }); return; }
    const vvpText = iv.FS.readFile('/work/out.vvp', { encoding: 'utf8' });
    const tCompile = performance.now() - t0;
    const out = [];
    const vv = await createVvp({ print: (s) => out.push(s), printErr: (s) => out.push(s) });
    vv.FS.mkdir('/work');
    vv.FS.chdir('/work');
    vv.FS.writeFile('/work/out.vvp', vvpText);
    const t1 = performance.now();
    const rc2 = vv.callMain(['/work/out.vvp']);
    // $dumpfile("anything.vcd") may land in / or /work depending on how it was written
    let vcd = null;
    for (const dir of ['/work', '/']) {
      let entries = [];
      try { entries = vv.FS.readdir(dir); } catch { continue; }
      const f = entries.find((n) => /\.vcd$/i.test(n));
      if (f) { try { vcd = vv.FS.readFile(`${dir === '/' ? '' : dir}/${f}`, { encoding: 'utf8' }); break; } catch { /* keep looking */ } }
    }
    self.postMessage({ id, ok: rc2 === 0, stage: 'run', log, out, vcd, msCompile: Math.round(tCompile), msRun: Math.round(performance.now() - t1) });
  } catch (err) {
    self.postMessage({ id, ok: false, stage: 'crash', log: [...log, String(err && err.message || err)] });
  }
};
