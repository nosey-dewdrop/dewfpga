// runs yosys (WebAssembly build from YoWASP) off the main thread.
import { runYosys } from '@yowasp/yosys';

const script = (names) => [
  `read_verilog -sv -DSIM ${names.join(' ')}`,
  'hierarchy -auto-top',
  'proc',
  'opt_clean',
  'fsm',
  'memory',
  'wreduce -memx',
  'opt_clean',
  'write_json out.json',
].join('; ');

let warm = null;
function warmUp() {
  // first call fetches + compiles the 64 MB core; do it once, early, and report the download.
  if (!warm) warm = runYosys(['-V'], {}, { stdout: null, stderr: null, fetchProgress: (e) => self.postMessage({ kind: 'progress', done: e.doneLength, total: e.totalLength }) }).catch(() => {});
  return warm;
}
const clean = (t) => t.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

self.onmessage = async (e) => {
  const { id, kind, files } = e.data;
  if (kind === 'warm') {
    await warmUp();
    self.postMessage({ id, ok: true });
    return;
  }
  let log = '';
  const sink = (s) => { if (s != null) log += typeof s === 'string' ? s : new TextDecoder().decode(s); };
  try {
    await warmUp();
    const t0 = performance.now();
    const tree = {}; for (const [n, t] of Object.entries(files)) tree[n] = clean(t);
    const out = await runYosys(['-q', '-p', script(Object.keys(tree))], tree, { stdout: sink, stderr: sink, decodeASCII: true });
    const json = out['out.json'];
    const text = typeof json === 'string' ? json : new TextDecoder().decode(json);
    self.postMessage({ id, ok: true, json: text, log, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    let msg = log || String(err && err.message || err);
    if (/WebAssembly|wasm/i.test(msg) && !log) {
      msg = msg + "\n\nyosys could not start in this browser. an old copy may be cached: reload the page once with a hard refresh (cmd shift r). if it keeps failing, try chrome or firefox and tell me which browser and version you are on.";
    }
    self.postMessage({ id, ok: false, log: msg });
  }
};
