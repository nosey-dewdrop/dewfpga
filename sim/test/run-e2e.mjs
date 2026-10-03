// npm test: build once, run UI, board and actual-worker checks against one local preview, then stop it.
// exits with e2e's code; the only processes it starts and stops are its own preview server, the e2e child and
// that child's descendants (the browser playwright launched), found by pid through `ps`, never by name.
//   E2E_TIMEOUT=ms   kill e2e and fail after this long (default 15 min)
//   BROWSER, E2E_EXECUTABLE, E2E_OUT pass through to test/e2e.mjs
import { build, preview } from 'vite';
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutMs = Number(process.env.E2E_TIMEOUT || 15 * 60 * 1000);

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// pids of every live descendant of `pid` (children, grandchildren, ...). playwright starts the browser detached
// (its own process group), so a group kill would miss it; the parent pid chain still names it while e2e is alive.
const descendants = (pid) => {
  if (process.platform === 'win32') return [];
  const ps = spawnSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' });
  if (ps.status !== 0) return [];
  const kids = new Map();
  for (const l of ps.stdout.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) (kids.get(+m[2]) || kids.set(+m[2], []).get(+m[2])).push(+m[1]);
  }
  const out = [], q = [pid];
  while (q.length) for (const c of kids.get(q.shift()) || []) { out.push(c); q.push(c); }
  return out;
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// kill the e2e child and whatever it left running: list descendants first (their ppid is lost once the child dies),
// SIGKILL the child, then SIGKILL any descendant still alive after a short grace (the browser normally exits on its own
// when its pipe to the child closes).
const killTree = async (why) => {
  if (!child || exited) return;
  const kids = descendants(child.pid);
  child.kill('SIGKILL');
  await sleep(500);
  const left = kids.filter(alive);
  for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  console.error(`e2e: ${why}; killed pid ${child.pid}, ${kids.length} descendant(s) listed, ${left.length} still alive and killed`);
};

let server, child, code = 1, timer, timedOut = false, exited = false;
const stop = async () => {
  if (timer) clearTimeout(timer);
  await killTree('stopping');
  if (server) { const s = server; server = null; await s.close().catch(() => {}); }
};
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { console.error(`${sig}: stopping`); await stop(); process.exit(130); });

try {
  await build({ root, logLevel: 'warn' });
  const port = await freePort();
  server = await preview({ root, logLevel: 'warn', preview: { host: '127.0.0.1', port, strictPort: true, open: false } });
  const base = `http://127.0.0.1:${port}/`;
  console.log(`preview ${base} (pid ${process.pid})`);
  const deadline = Date.now() + timeoutMs;
  for (const suite of ['e2e.mjs', 'sim17-evidence.mjs', 'board-e2e.mjs', 'hardware-validation.mjs']) {
    exited = false; timedOut = false;
    console.log(`suite ${suite}`);
    code = await new Promise((resolve) => {
      child = spawn(process.execPath, [path.join(root, 'test', suite)], { cwd: root, stdio: 'inherit', env: { ...process.env, BASE: base } });
      timer = setTimeout(() => { timedOut = true; killTree(`${suite}: total browser suite exceeded ${timeoutMs} ms`).then(() => resolve(124)); }, Math.max(1, deadline - Date.now()));
      child.on('exit', (c, sig) => { exited = true; clearTimeout(timer); if (sig) console.error(`${suite} exited by ${sig}`); if (!timedOut) resolve(c === null ? 128 : c); });
      child.on('error', (e) => { clearTimeout(timer); console.error(`${suite}: ${e.message}`); resolve(1); });
    });
    if (code !== 0) break;
  }
} catch (e) {
  console.error(`run-e2e: ${e.stack || e.message}`);
  code = 1;
} finally {
  await stop();
}
process.exit(code);
