'use strict';
// node test/vscode/test-extension.js  -> "passed N, failed 0". No VS Code: a small API stub + real subprocesses.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const ext = require(path.join(ROOT, 'vscode', 'extension.js'));
const L = ext.lib;
const FX = path.join(__dirname, 'fixtures', 'with space');
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } }

// A QuickPick with only members of the real vscode.QuickPick that the extension may touch; sealed, so a
// write to any other property (an invented option) throws in strict mode. `script` drives one pick:
// undefined -> hidden (Escape), '__enter__' -> Enter on the highlighted row, '__enter_empty__' -> Enter with
// nothing highlighted (stays open, then hidden), a label -> that row selected and accepted, then hidden as VS Code does.
function quickPick(record, script) {
  const accept = [], hide = [];
  const ev = (list) => (fn) => { list.push(fn); return { dispose() { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } }; };
  const qp = Object.seal({
    items: [], placeholder: undefined, ignoreFocusOut: false, canSelectMany: false, activeItems: [], selectedItems: [],
    onDidAccept: ev(accept), onDidHide: ev(hide),
    show() {
      record.shown = true; record.items = qp.items; record.placeholder = qp.placeholder; record.activeItems = qp.activeItems.slice();
      record.ignoreFocusOut = qp.ignoreFocusOut;
      setImmediate(() => {
        if (script === '__enter__') { accept.slice().forEach((f) => f()); }
        else if (script === '__enter_empty__') { qp.activeItems = []; accept.slice().forEach((f) => f()); record.stillOpen = !record.disposed; }
        else if (script !== undefined) { qp.selectedItems = [qp.items.find((i) => i.label === script)]; qp.activeItems = qp.selectedItems; accept.slice().forEach((f) => f()); }
        hide.slice().forEach((f) => f()); // VS Code hides the pick after an accept too
      });
    },
    hide() { hide.slice().forEach((f) => f()); },
    dispose() { record.disposed = true; record.listenersLeft = accept.length + hide.length; },
  });
  return qp;
}
function stub(opts) {
  const o = Object.assign({ picks: [], folders: [], active: undefined, verilog: {}, ws: {}, wsf: {}, config: {} }, opts);
  const s = {
    calls: { errors: [], infos: [], warns: [], status: [], opened: [], quickPicks: [], updates: [] },
    ConfigurationTarget: { Global: 1 },
    Uri: { file: (p) => ({ scheme: 'file', fsPath: p }) },
    window: {
      activeTextEditor: o.active ? { document: { uri: { scheme: 'file', fsPath: o.active } } } : undefined,
      createQuickPick: () => { const rec = {}; s.calls.quickPicks.push(rec); return quickPick(rec, o.picks.shift()); },
      showErrorMessage: (m) => { s.calls.errors.push(m); },
      showInformationMessage: async (m) => { s.calls.infos.push(m); return o.answer; },
      showWarningMessage: (m) => { s.calls.warns.push(m); },
      setStatusBarMessage: (m) => { s.calls.status.push(m); },
    },
    workspace: {
      workspaceFolders: o.folders.map((f) => ({ uri: { scheme: 'file', fsPath: f } })),
      getConfiguration: (section) => ({
        get: (k, dflt) => (section === 'dewfpga' ? o.config[k] : o.verilog[k]) ?? dflt,
        inspect: (k) => ({ key: section + '.' + k, globalValue: o.verilog[k], workspaceValue: o.ws[k], workspaceFolderValue: o.wsf[k] }),
        update: async (k, v, target) => { if (target !== 1) throw new Error('only user settings (Global) may be written'); s.calls.updates.push([section, k, v]); if (v === undefined) delete o.verilog[k]; else o.verilog[k] = v; },
      }),
    },
    commands: { registerCommand: (id, fn) => ({ id, fn, dispose() {} }), executeCommand: async (c, u) => { s.calls.opened.push([c, u.fsPath]); } },
    tasks: { onDidStartTaskProcess: (f) => ({ dispose() {} }), onDidEndTaskProcess: (f) => ({ dispose() {} }) },
  };
  return s;
}
function ctx(extPath) {
  const ws = {}, gs = {};
  return { extensionPath: extPath || '/ext/dir', subscriptions: [],
    workspaceState: { get: (k, d) => (k in ws ? ws[k] : d), update: async (k, v) => { ws[k] = v; } },
    globalState: { get: (k, d) => (k in gs ? gs[k] : d), update: async (k, v) => { if (v === undefined) delete gs[k]; else gs[k] = v; } }, _ws: ws, _gs: gs };
}
// fake dewfpga CLI: prints the lines of DEWFPGA_FAKE_TOPS (|-separated) for `tops`
const fakeCli = path.join(os.tmpdir(), 'dewfpga fake ' + process.pid, 'dewfpga');
fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
fs.writeFileSync(fakeCli, '#!/bin/bash\n[ "$1" = tops ] || { echo "unknown" >&2; exit 1; }\n[ -z "$DEWFPGA_FAKE_FAIL" ] || { echo "ERROR [two-vivado-projects]: two .xpr here" >&2; exit 1; }\nprintf "%s" "$DEWFPGA_FAKE_TOPS" | tr "|" "\\n"\npwd > "${DEWFPGA_FAKE_CWD_LOG:-/dev/null}"\n', { mode: 0o755 });
const cwdLog = path.join(path.dirname(fakeCli), 'cwd.log');
function run(opts, tops, c) {
  const s = stub(Object.assign({ config: { cliPath: fakeCli } }, opts));
  const execFile = (file, args, o, cb) => require('child_process').execFile(file, args, Object.assign({}, o, { env: Object.assign({}, process.env, { DEWFPGA_FAKE_TOPS: tops === null ? '' : tops, DEWFPGA_FAKE_FAIL: tops === 'FAIL' ? '1' : '', DEWFPGA_FAKE_CWD_LOG: cwdLog }) }), cb);
  const e = ext.createExtension(s, c, { execFile });
  return { s, e };
}

(async () => {
  // --- matcher ---
  await t('matcher regexp equals package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode', 'package.json')));
    const pm = pkg.contributes.problemMatchers[0];
    assert.strictEqual(pm.pattern.regexp, L.MATCHER_REGEXP);
    assert.strictEqual(pm.severity, 'info'); // lowercase per VS Code's schema; the fallback only
    assert.deepStrictEqual([pm.pattern.file, pm.pattern.line, pm.pattern.severity, pm.pattern.code, pm.pattern.message], [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(pkg.contributes.commands.map((c) => c.command), ['dewfpga.pickTop', 'dewfpga.forgetTop', 'dewfpga.setupLinter', 'dewfpga.removeLinter']);
  });
  await t('matcher: ERROR/warning/note, file with spaces and abs path', () => {
    assert.deepStrictEqual(L.parseDiagnostic('design.sv:3: ERROR [two-tops]: two modules could be the top. Fix: x https://e/'), { file: 'design.sv', line: 3, severity: 'error', code: 'two-tops', message: 'two modules could be the top. Fix: x https://e/' });
    assert.strictEqual(L.parseDiagnostic('design.sv:3: warning [latch]: latch inferred for q').severity, 'warning');
    assert.strictEqual(L.parseDiagnostic('design.sv:5: note [unnamed-instance]: named the instance').severity, 'info');
    assert.deepStrictEqual(L.parseDiagnostic('/Users/you/Working Lab/NEW.srcs/sim_1/new/tb.sv:11: ERROR [testbench-error]: m').file, '/Users/you/Working Lab/NEW.srcs/sim_1/new/tb.sv');
    assert.strictEqual(L.parseDiagnostic('ERROR [toolchain-not-installed]: something is missing'), null); // no location: not a file problem
    assert.strictEqual(L.parseDiagnostic('note [no-install-found]: nothing to remove'), null);
    assert.strictEqual(L.parseDiagnostic('design.sv:3: error [x]: lowercase error is not ours'), null);
    assert.strictEqual(L.parseDiagnostic('tb.sv:11: $finish called'), null);
  });
  await t('matcher: every located message in expect.tsv parses', () => {
    const tsvPath = process.env.DEWFPGA_EXPECT_TSV || path.join(ROOT, 'test', 'sv', 'expect.tsv');
    assert.ok(fs.existsSync(tsvPath), 'test/sv/expect.tsv is required (or set DEWFPGA_EXPECT_TSV)');
    const tsv = fs.readFileSync(tsvPath, 'utf8');
    const re = /'([^'\t]+:\d+: (?:ERROR|warning|note) \[[a-z0-9-]+\]: [^'\t]*)/g; let m, n = 0;
    while ((m = re.exec(tsv))) { n++; assert.ok(L.parseDiagnostic(m[1]), m[1]); }
    assert.ok(n >= 20, 'found ' + n + ' sample messages');
  });
  // --- tops / choose ---
  await t('parseTops', () => {
    assert.deepStrictEqual(L.parseTops('top\tNEW.srcs/sources_1/new/top.sv\nalu\t../archive/a lu.sv\n\n'), [{ module: 'top', file: 'NEW.srcs/sources_1/new/top.sv' }, { module: 'alu', file: '../archive/a lu.sv' }]);
    assert.deepStrictEqual(L.parseTops(''), []);
    assert.deepStrictEqual(L.parseTops('vivado project: x\n'), []);
  });
  await t('chooseTop: 0/1 auto, 2 ask, remembered preselected, stale dropped', () => {
    const two = [{ module: 'a', file: 'a.sv' }, { module: 'b', file: 'b.sv' }];
    assert.deepStrictEqual(L.chooseTop([], undefined), { action: 'auto', top: '' });
    assert.deepStrictEqual(L.chooseTop([two[0]], 'a'), { action: 'auto', top: '' });
    assert.deepStrictEqual(L.chooseTop(two, undefined), { action: 'ask', preselect: undefined, stale: false });
    assert.deepStrictEqual(L.chooseTop(two, 'b'), { action: 'ask', preselect: 1, stale: false });
    assert.deepStrictEqual(L.chooseTop(two, 'gone'), { action: 'ask', preselect: undefined, stale: true });
  });
  // --- cli path ---
  await t('resolveCliPath', () => {
    const ex = (p) => p === '/usr/local/bin/dewfpga' || p === '/abs/d';
    assert.deepStrictEqual(L.resolveCliPath('', ex, '/h'), { cli: '/usr/local/bin/dewfpga' });
    assert.deepStrictEqual(L.resolveCliPath('/abs/d', ex, '/h'), { cli: '/abs/d' });
    assert.match(L.resolveCliPath('dewfpga', ex, '/h').error, /absolute/);
    assert.match(L.resolveCliPath('/abs/missing', ex, '/h').error, /no file there/);
    assert.match(L.resolveCliPath('', () => false, '/h').error, /dewfpga install/);
    assert.deepStrictEqual(L.resolveCliPath('', (p) => p === '/h/fpga/dewfpga/bin/dewfpga', '/h'), { cli: '/h/fpga/dewfpga/bin/dewfpga' });
    // site/install's default DEWFPGA_DIR is ~/.dewfpga: found, and before ~/fpga/dewfpga
    assert.deepStrictEqual(L.resolveCliPath('', (p) => p === '/h/.dewfpga/bin/dewfpga', '/h'), { cli: '/h/.dewfpga/bin/dewfpga' });
    assert.deepStrictEqual(L.resolveCliPath('', (p) => p.startsWith('/h/'), '/h'), { cli: '/h/.dewfpga/bin/dewfpga' });
    assert.match(L.resolveCliPath('', () => false, '/h').error, /~\/\.dewfpga\/bin\/dewfpga/);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vscode', 'package.json'), 'utf8'));
    assert.match(pkg.contributes.configuration.properties['dewfpga.cliPath'].markdownDescription, /~\/\.dewfpga\/bin\/dewfpga/);
  });
  await t('privacy: no /Users/<name> path but the /Users/you placeholder in the extension or its tests', () => {
    const files = [path.join(ROOT, 'vscode', 'extension.js'), path.join(ROOT, 'vscode', 'package.json'), path.join(ROOT, 'vscode', 'build-vsix.py'), path.join(ROOT, 'vscode', 'bin', 'iverilog'), __filename];
    for (const f of files) {
      const bad = (fs.readFileSync(f, 'utf8').match(/\/Users\/[A-Za-z0-9._-]+/g) || []).filter((m) => m !== '/Users/you');
      assert.deepStrictEqual(bad, [], f);
    }
  });
  // --- pickTop with the fake CLI (real subprocess, folder with a space) ---
  const folder = path.join(FX); // has a space
  await t('pickTop: two tops -> quick pick, choice remembered and preselected next time', async () => {
    const c = ctx(); const { s, e } = run({ active: path.join(folder, 'x.sv'), picks: ['b', 'a'] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await e.pickTop(), 'b');
    assert.strictEqual(fs.readFileSync(cwdLog, 'utf8').trim(), fs.realpathSync(folder));
    assert.deepStrictEqual(s.calls.quickPicks[0].activeItems, []); // nothing remembered: nothing forced
    assert.strictEqual(s.calls.quickPicks[0].disposed, true); assert.strictEqual(s.calls.quickPicks[0].listenersLeft, 0);
    assert.strictEqual(s.calls.quickPicks[0].ignoreFocusOut, true);
    assert.deepStrictEqual(c._ws['dewfpga.topByFolder'], { [folder]: 'b' });
    assert.strictEqual(await e.pickTop(), 'a');
    assert.deepStrictEqual(s.calls.quickPicks[1].activeItems.map((i) => i.label), ['b']); // only the remembered one
    assert.ok(s.calls.quickPicks[1].items.includes(s.calls.quickPicks[1].activeItems[0]), 'active item is one of the items (same object)');
    assert.deepStrictEqual(s.calls.quickPicks[1].items.map((i) => [i.label, i.description]), [['a', 'a.sv'], ['b', 'b.sv']]);
  });
  await t('pickTop: Enter on the highlighted remembered row returns it', async () => {
    const c = ctx(); c._ws['dewfpga.topByFolder'] = { [folder]: 'b' };
    const { e } = run({ active: path.join(folder, 'x.sv'), picks: ['__enter__'] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await e.pickTop(), 'b');
  });
  await t('pickOne: accept then hide resolves once with the accepted item; Enter on no row keeps it open; hide -> undefined', async () => {
    const items = [{ label: 'a' }, { label: 'b' }];
    const s = stub({ picks: ['b', '__enter_empty__', undefined] });
    assert.strictEqual(await L.pickOne(s, items, 'p', items[0]), items[1]);
    assert.strictEqual(await L.pickOne(s, items, 'p', undefined), undefined);
    assert.strictEqual(s.calls.quickPicks[1].stillOpen, true); // the empty accept did not close it; the hide did
    assert.strictEqual(await L.pickOne(s, items, 'p', items[1]), undefined);
    assert.ok(s.calls.quickPicks.every((r) => r.disposed && r.listenersLeft === 0));
    // the stub really refuses API that a QuickPick does not have
    assert.throws(() => { s.window.createQuickPick().notAnApi = 1; }, TypeError);
  });
  await t('pickTop: cancel returns undefined, nothing remembered, no error shown', async () => {
    const c = ctx(); const { s, e } = run({ active: path.join(folder, 'x.sv'), picks: [undefined] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await e.pickTop(), undefined);
    assert.deepStrictEqual(c._ws, {}); assert.deepStrictEqual(s.calls.errors, []);
  });
  await t('pickTop: stale remembered choice is not preselected and is dropped on cancel', async () => {
    const c = ctx(); c._ws['dewfpga.topByFolder'] = { [folder]: 'gone', '/other': 'keep' };
    const { s, e } = run({ active: path.join(folder, 'x.sv'), picks: [undefined] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await e.pickTop(), undefined);
    assert.deepStrictEqual(s.calls.quickPicks[0].activeItems, []);
    assert.match(s.calls.quickPicks[0].placeholder, /gone is no longer/);
    assert.deepStrictEqual(c._ws['dewfpga.topByFolder'], { '/other': 'keep' });
  });
  await t('pickTop: one top -> "" without asking; zero tops -> "" (CLI explains); memory cleared', async () => {
    const c = ctx(); c._ws['dewfpga.topByFolder'] = { [folder]: 'old' };
    const { s, e } = run({ active: path.join(folder, 'x.sv') }, 'only\tonly.sv', c);
    assert.strictEqual(await e.pickTop(), ''); assert.strictEqual(s.calls.quickPicks.length, 0);
    assert.deepStrictEqual(c._ws['dewfpga.topByFolder'], {});
    const r2 = run({ folders: [folder] }, null, ctx()); // no editor: first workspace folder
    assert.strictEqual(await r2.e.pickTop(), ''); assert.strictEqual(fs.readFileSync(cwdLog, 'utf8').trim(), fs.realpathSync(folder));
  });
  await t('pickTop: CLI failure -> error message with its first stderr line, task cancelled', async () => {
    const { s, e } = run({ active: path.join(folder, 'x.sv') }, 'FAIL', ctx());
    assert.strictEqual(await e.pickTop(), undefined); assert.match(s.calls.errors[0], /two-vivado-projects/);
  });
  await t('pickTop: no folder / bad cliPath -> error, undefined', async () => {
    const r1 = run({}, 'a\ta.sv', ctx()); assert.strictEqual(await r1.e.pickTop(), undefined); assert.match(r1.s.calls.errors[0], /open a .sv file/);
    const r2 = run({ active: '/x/y.sv', config: { cliPath: '/nope/dewfpga' } }, 'a\ta.sv', ctx()); assert.strictEqual(await r2.e.pickTop(), undefined); assert.match(r2.s.calls.errors[0], /no file there/);
  });
  // --- the Vivado project root: projectRoot() against the CLI's own locate() ---
  const DFV = process.env.DEWFPGA_TEST_CLI || path.join(ROOT, 'bin', 'dewfpga');
  const VIVADO_FIXTURE = process.env.DEWFPGA_VIVADO_FIXTURE || path.join(ROOT, 'test', 'vivado', 'fixture');
  const haveDfv = fs.existsSync(DFV);
  // runs the walk of locate() taken verbatim from the CLI source (up to "[ -n "$root" ] || return 0") in `dir`
  // with HOME=home, and prints the root it found ('' = none) or the die() code
  function cliRoot(dir, home) {
    const src = fs.readFileSync(DFV, 'utf8');
    const a = src.indexOf('locate() {'), b = src.indexOf('[ -n "$root" ] || return 0', a);
    assert.ok(a >= 0 && b > a, 'locate() found in the CLI');
    const script = 'die() { echo "DIE $1"; exit 0; }\n' + src.slice(a, b) + 'echo "ROOT=$root"\n}\ncd "$1" && locate\n';
    const r = spawnSync('/bin/bash', ['-c', script, '_', dir], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: home, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' } });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = r.stdout.trim();
    if (out.startsWith('DIE ')) return { error: out.slice(4) };
    return { root: out.slice(5) || dir };
  }
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'dewfpga root '));
  const mk = (rel) => { fs.mkdirSync(path.join(proj, rel), { recursive: true }); return path.join(proj, rel); };
  const touch = (rel) => { mk(path.dirname(rel)); fs.writeFileSync(path.join(proj, rel), 'x'); return path.join(proj, rel); };
  touch('one lab/LAB.xpr'); mk('one lab/LAB.srcs/sim_1/new'); mk('one lab/LAB.srcs/sources_1/new');
  touch('two xpr/A.xpr'); touch('two xpr/B.xpr'); mk('two xpr/A.srcs/sources_1/new');
  touch('no xpr/.hidden.xpr'); mk('no xpr/P.srcs/sources_1/new'); mk('no xpr/P.srcs/sim_1/new');
  touch('deep/Q.xpr'); mk('deep/Q.srcs/a/b/c/d/e/f/g');
  touch('not srcs/R.xpr'); mk('not srcs/plain/sub');
  touch('home stop/S.xpr'); mk('home stop/home.srcs/in');
  mk('dir xpr/D.xpr'); mk('dir xpr/D.srcs/sim_1');
  touch('link xpr/real.file'); fs.symlinkSync(path.join(proj, 'link xpr/real.file'), path.join(proj, 'link xpr/L.xpr')); mk('link xpr/L.srcs/sim_1');
  mk('dangling/M.srcs/sim_1'); fs.symlinkSync(path.join(proj, 'dangling/nowhere'), path.join(proj, 'dangling/M.xpr'));
  mk('flat');
  const home0 = path.join(proj, 'home stop', 'home.srcs');
  const cases = [
    ['one lab/LAB.srcs/sim_1/new', 'one lab'], ['one lab/LAB.srcs/sources_1/new', 'one lab'], ['one lab/LAB.srcs', 'one lab'], ['one lab', 'one lab'],
    ['two xpr/A.srcs/sources_1/new', 'ERROR'], ['two xpr', 'ERROR'],
    ['no xpr/P.srcs/sim_1/new', 'no xpr'],
    ['deep/Q.srcs/a/b/c/d/e/f/g', 'SELF'], ['deep/Q.srcs/a/b/c/d/e/f', 'SELF'], ['deep/Q.srcs/a/b/c/d/e', 'deep'],
    ['not srcs/plain/sub', 'SELF'],
    ['home stop/home.srcs/in', 'SELF'],
    ['dir xpr/D.srcs/sim_1', 'SELF'], ['link xpr/L.srcs/sim_1', 'link xpr'], ['dangling/M.srcs/sim_1', 'SELF'], ['flat', 'SELF'],
  ];
  await t('projectRoot: the bounded walk (7 folders, .srcs only, not past HOME), equal to the CLI locate() in ' + cases.length + ' folders', () => {
    for (const [rel, want] of cases) {
      const dir = path.join(proj, rel);
      const got = L.projectRoot(dir, home0);
      if (want === 'ERROR') assert.match(got.error || '', /^2 Vivado projects in /, rel);
      else assert.deepStrictEqual(got, { root: want === 'SELF' ? dir : path.join(proj, want) }, rel);
      assert.ok(haveDfv, 'the repository CLI is required for project-root parity');
      const cli = cliRoot(dir, home0);
      if (want === 'ERROR') assert.deepStrictEqual(cli, { error: 'two-vivado-projects' }, rel);
      else assert.deepStrictEqual(cli, got, 'parity with the CLI: ' + rel);
    }
    // without the HOME stop the same folder climbs to the project
    assert.deepStrictEqual(L.projectRoot(path.join(proj, 'home stop/home.srcs/in'), '/nonexistent'), { root: path.join(proj, 'home stop') });
    assert.deepStrictEqual(cliRoot(path.join(proj, 'home stop/home.srcs/in'), '/nonexistent'), { root: path.join(proj, 'home stop') });
  });
  await t('real repository CLI: tops from sim_1/new answers for the root projectRoot() names; one remembered top per project', async () => {
    assert.ok(haveDfv, 'the repository CLI is required');
    fs.cpSync(VIVADO_FIXTURE, path.join(proj, 'fixture'), { recursive: true }); // with archive/, which the .xpr names
    const lab = path.join(proj, 'fixture', 'Working Lab');
    const sim = path.join(lab, 'NEW.srcs', 'sim_1', 'new'), src = path.join(lab, 'NEW.srcs', 'sources_1', 'new');
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' };
    const fromSim = execFileSync(DFV, ['tops'], { cwd: sim, encoding: 'utf8', env }), fromRoot = execFileSync(DFV, ['tops'], { cwd: lab, encoding: 'utf8', env });
    assert.strictEqual(fromSim, fromRoot); // the CLI answered from the root: the paths are root-relative
    assert.deepStrictEqual(L.parseTops(fromSim), [{ module: 'topmodule', file: 'NEW.srcs/sources_1/new/topmodule.sv' }]);
    assert.ok(fs.existsSync(path.join(L.projectRoot(sim).root, L.parseTops(fromSim)[0].file)), 'the path resolves against projectRoot()');
    assert.deepStrictEqual(cliRoot(sim, process.env.HOME), { root: lab });
    assert.deepStrictEqual(L.projectRoot(sim, process.env.HOME), { root: lab });
    const s = stub({ active: path.join(src, 'topmodule.sv'), config: { cliPath: DFV } });
    assert.strictEqual(await ext.createExtension(s, ctx(), {}).pickTop(), ''); // one candidate
    // two candidates through the fake CLI: the choice made from sources_1/new is the one highlighted from sim_1/new
    const c = ctx();
    const r1 = run({ active: path.join(src, 'topmodule.sv'), picks: ['b'] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await r1.e.pickTop(), 'b');
    assert.deepStrictEqual(c._ws['dewfpga.topByFolder'], { [lab]: 'b' });
    const r2 = run({ active: path.join(sim, 'tb.sv'), picks: ['__enter__'] }, 'a\ta.sv|b\tb.sv', c);
    assert.strictEqual(await r2.e.pickTop(), 'b');
    assert.deepStrictEqual(r2.s.calls.quickPicks[0].activeItems.map((i) => i.label), ['b']);
  });
  // --- task folder + waveform ---
  await t('resolveTaskFolder', () => {
    assert.strictEqual(L.resolveTaskFolder('${fileDirname}', '/a b/c/x.sv', '/ws'), '/a b/c');
    assert.strictEqual(L.resolveTaskFolder('${fileDirname}', undefined, '/ws'), undefined);
    assert.strictEqual(L.resolveTaskFolder('${workspaceFolder}/lab 3', '/e/x.sv', '/ws'), '/ws/lab 3');
    assert.strictEqual(L.resolveTaskFolder('/abs/dir', '/e/x.sv', '/ws'), '/abs/dir');
    assert.strictEqual(L.resolveTaskFolder('rel', '/e/x.sv', '/ws'), '/ws/rel');
    assert.strictEqual(L.resolveTaskFolder('${unknownVar}', '/e/x.sv', '/ws'), undefined);
    assert.strictEqual(L.resolveTaskFolder(undefined, '/e/x.sv', '/ws'), '/ws');
    assert.strictEqual(L.resolveTaskFolder(undefined, '/e/x.sv', undefined), '/e');
  });
  await t('simTaskKind / isSimTask', () => {
    assert.strictEqual(L.simTaskKind({ name: 'dewfpga: simulate', execution: {} }), 'cli');
    assert.strictEqual(L.simTaskKind({ name: 'FPGA: simulate', execution: {} }), 'cli');
    assert.strictEqual(L.simTaskKind({ name: 'x', execution: { command: '/opt/homebrew/bin/dewfpga', args: ['sim', '${input:dewfpgaTop}'] } }), 'cli');
    assert.strictEqual(L.simTaskKind({ name: 'FPGA: simulate', execution: { commandLine: 'make sim' } }), 'make');
    assert.strictEqual(L.simTaskKind({ name: 'x', execution: { commandLine: 'make sim' } }), 'make');
    assert.strictEqual(L.simTaskKind({ name: 'dewfpga: flash (build + program)', execution: { command: '/x/dewfpga', args: ['flash'] } }), null);
    assert.strictEqual(L.simTaskKind({ name: 'simulate', execution: { commandLine: 'echo dewfpga simulate' } }), null);
    assert.strictEqual(L.simTaskKind({ name: 'x', execution: { commandLine: 'make simulate' } }), null);
    assert.ok(L.isSimTask({ name: 'x', execution: { commandLine: 'make sim' } })); assert.ok(!L.isSimTask(undefined));
  });
  const wdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dewfpga vcd '));
  const sameTimes = (p, from) => { const st = fs.statSync(from); fs.utimesSync(p, st.atime, st.mtime); };
  await t('pickFreshVcd: an untouched old file is never fresh, whatever its mtime (same second, future, now)', () => {
    const old = path.join(wdir, 'old.vcd'); fs.writeFileSync(old, 'x');
    const now = new Date(); const sec = new Date(Math.floor(now.getTime() / 1000) * 1000);
    for (const when of [sec, now, new Date(now.getTime() + 60000)]) { // the old floor check took a same-second file as fresh
      fs.utimesSync(old, when, when);
      const before = L.snapshotVcds(wdir);
      assert.strictEqual(L.pickFreshVcd(wdir, before), null, String(when.getTime()));
    }
    assert.deepStrictEqual(Object.keys(L.snapshotVcds(wdir)), ['old.vcd']);
  });
  await t('pickFreshVcd: new file; rewrite with other bytes but same size and mtime; replaced inode; newest wins', () => {
    for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f), { recursive: true });
    const a = path.join(wdir, 'a.vcd'); fs.writeFileSync(a, 'aaaa');
    let before = L.snapshotVcds(wdir);
    const fresh = path.join(wdir, 'top sim.vcd'); fs.writeFileSync(fresh, 'y');
    assert.strictEqual(L.pickFreshVcd(wdir, before), fresh); // new
    before = L.snapshotVcds(wdir);
    const keep = fs.statSync(a); fs.writeFileSync(a, 'bbbb'); fs.utimesSync(a, keep.atime, keep.mtime); // same inode, size, mtime
    assert.strictEqual(L.pickFreshVcd(wdir, before), a); // the hash differs
    before = L.snapshotVcds(wdir);
    const tmp = path.join(wdir, 'a.tmp'); fs.writeFileSync(tmp, 'bbbb'); sameTimes(tmp, a); fs.renameSync(tmp, a); // same bytes, new inode
    assert.strictEqual(L.pickFreshVcd(wdir, before), a);
    before = L.snapshotVcds(wdir);
    const z = path.join(wdir, 'z.vcd'); fs.writeFileSync(z, 'z'); fs.utimesSync(z, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    fs.writeFileSync(path.join(wdir, 'b.vcd'), 'b');
    assert.strictEqual(L.pickFreshVcd(wdir, before), z); // two fresh: the newest mtime
  });
  await t('pickFreshVcd: only *.vcd files directly in the folder; literal glob name; folder named x.vcd; missing folder', () => {
    for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f), { recursive: true });
    const before = L.snapshotVcds(wdir);
    fs.mkdirSync(path.join(wdir, 'waves')); fs.writeFileSync(path.join(wdir, 'waves', 'tb.vcd'), 'n'); // a $dumpfile("waves/tb.vcd")
    fs.mkdirSync(path.join(wdir, 'dir.vcd'));
    fs.writeFileSync(path.join(wdir, 'tb.vcd.bak'), 'n'); fs.writeFileSync(path.join(wdir, 'not.txt'), 'n');
    assert.strictEqual(L.pickFreshVcd(wdir, before), null);
    fs.writeFileSync(path.join(wdir, '*.vcd'), 'g'); // a literal glob name is just a file
    assert.strictEqual(L.pickFreshVcd(wdir, before), path.join(wdir, '*.vcd'));
    assert.strictEqual(L.pickFreshVcd(path.join(wdir, 'missing'), {}), null);
    assert.deepStrictEqual(L.snapshotVcds(path.join(wdir, 'missing')), {});
  });
  await t('task start/end: folder taken at start, VCD opened only on exit 0 and only when new or changed', async () => {
    for (const f of fs.readdirSync(wdir)) fs.rmSync(path.join(wdir, f), { recursive: true });
    const stale = path.join(wdir, 'stale.vcd'); fs.writeFileSync(stale, 's');
    const s = stub({ active: path.join(wdir, 'tb.sv') }); const e = ext.createExtension(s, ctx(), {});
    const task = { name: 'dewfpga: simulate', execution: { command: '/x/dewfpga', args: ['sim'], options: { cwd: '${fileDirname}' } } };
    const exec = { task };
    e.onTaskStart({ execution: exec });
    s.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: '/elsewhere/other.sv' } } }; // editor moves before the task ends
    await e.onTaskEnd({ execution: exec, exitCode: 0 });
    assert.deepStrictEqual(s.calls.opened, []);
    assert.strictEqual(s.calls.status[0], `dewfpga: no new or changed .vcd directly in ${wdir} (a $dumpfile into another folder is not opened)`);
    s.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: path.join(wdir, 'tb.sv') } } };
    e.onTaskStart({ execution: exec }); // again; this run rewrites stale.vcd within the same second
    const st = fs.statSync(stale); fs.writeFileSync(stale, 't'); fs.utimesSync(stale, st.atime, st.mtime);
    s.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: '/elsewhere/other.sv' } } }; // moved again: the folder from the start wins
    await e.onTaskEnd({ execution: exec, exitCode: 0 });
    assert.deepStrictEqual(s.calls.opened, [['vscode.open', stale]]);
    s.window.activeTextEditor = { document: { uri: { scheme: 'file', fsPath: path.join(wdir, 'tb.sv') } } };
    e.onTaskStart({ execution: exec }); fs.writeFileSync(path.join(wdir, 'fail.vcd'), 'f');
    await e.onTaskEnd({ execution: exec, exitCode: 1 });
    assert.strictEqual(s.calls.opened.length, 1); // failed sim: nothing opened
    const flash = { execution: { task: { name: 'dewfpga: flash (build + program)', execution: { command: '/x/dewfpga', args: ['flash'] } } } };
    e.onTaskStart(flash); await e.onTaskEnd({ execution: flash.execution, exitCode: 0 }); assert.strictEqual(s.calls.opened.length, 1);
  });
  await t('task start/end in a Vivado project: `dewfpga sim` from sim_1/new reads the root, `make sim` reads its cwd', async () => {
    const lab = path.join(proj, 'one lab'), sim = path.join(lab, 'LAB.srcs', 'sim_1', 'new');
    const s = stub({ active: path.join(sim, 'tb.sv') }); const e = ext.createExtension(s, ctx(), { home: '/nonexistent' });
    const cli = { task: { name: 'dewfpga: simulate', execution: { command: '/x/dewfpga', args: ['sim'], options: { cwd: '${fileDirname}' } } } };
    e.onTaskStart({ execution: cli });
    fs.writeFileSync(path.join(sim, 'tb.vcd'), 'not where the CLI writes'); fs.writeFileSync(path.join(lab, 'tb.vcd'), 'cli');
    await e.onTaskEnd({ execution: cli, exitCode: 0 });
    assert.deepStrictEqual(s.calls.opened, [['vscode.open', path.join(lab, 'tb.vcd')]]);
    const mk2 = { task: { name: 'FPGA: simulate', execution: { commandLine: 'make sim', options: { cwd: '${fileDirname}' } } } };
    e.onTaskStart({ execution: mk2 });
    fs.writeFileSync(path.join(sim, 'tb.vcd'), 'make');
    await e.onTaskEnd({ execution: mk2, exitCode: 0 });
    assert.deepStrictEqual(s.calls.opened[1], ['vscode.open', path.join(sim, 'tb.vcd')]);
  });
  // --- linter ownership ---
  const OWNED = 'dewfpga.lintingPathOwnership';
  await t('linter: unset -> set (ownership recorded) -> already -> stop restores unset', async () => {
    const c = ctx('/ext dir'); const s = stub({ verilog: { 'linting.linter': 'iverilog' } }); const e = ext.createExtension(s, c, {});
    assert.deepStrictEqual(await e.setupLinter(), { action: 'set', value: '/ext dir/bin', previous: undefined });
    assert.deepStrictEqual(s.calls.updates, [['verilog', 'linting.path', '/ext dir/bin']]);
    assert.deepStrictEqual(c._gs[OWNED], { value: '/ext dir/bin', previous: undefined });
    assert.strictEqual((await e.setupLinter()).action, 'already'); assert.strictEqual(s.calls.updates.length, 1);
    assert.deepStrictEqual(await e.removeLinter(), { action: 'restored', value: undefined });
    assert.deepStrictEqual(s.calls.updates.at(-1), ['verilog', 'linting.path', undefined]); assert.ok(!('linting.path' in s.calls.updates));
    assert.strictEqual(c._gs[OWNED], undefined);
    assert.strictEqual((await e.removeLinter()).action, 'none'); assert.strictEqual(s.calls.updates.length, 2);
  });
  await t('linter: "" -> set -> stop puts "" back (not unset)', async () => {
    const c = ctx('/ext dir'); const s = stub({ verilog: { 'linting.path': '' } }); const e = ext.createExtension(s, c, {});
    assert.deepStrictEqual(await e.setupLinter(), { action: 'set', value: '/ext dir/bin', previous: '' });
    assert.deepStrictEqual(await e.removeLinter(), { action: 'restored', value: '' });
    assert.deepStrictEqual(s.calls.updates.at(-1), ['verilog', 'linting.path', '']); assert.match(s.calls.infos.at(-1), /"" again/);
  });
  await t('linter: a value already equal to the shim folder is not taken over; stop leaves it', async () => {
    const c = ctx('/ext dir'); const s = stub({ verilog: { 'linting.linter': 'iverilog', 'linting.path': '/ext dir/bin' } }); const e = ext.createExtension(s, c, {});
    assert.strictEqual((await e.setupLinter()).action, 'not-ours'); assert.strictEqual(c._gs[OWNED], undefined);
    assert.strictEqual((await e.removeLinter()).action, 'none'); assert.deepStrictEqual(s.calls.updates, []);
    await e.maybeOfferLinter(); assert.strictEqual(s.calls.infos.filter((m) => /Set up|constant selects/.test(m)).length, 0);
  });
  await t('linter: a workspace or folder value wins -> nothing written, no offer', async () => {
    for (const o of [{ ws: { 'linting.path': '/proj/tools' } }, { wsf: { 'linting.path': '' } }]) {
      const c = ctx('/e'); const s = stub(Object.assign({ verilog: { 'linting.linter': 'iverilog' }, answer: 'Set up' }, o)); const e = ext.createExtension(s, c, {});
      assert.strictEqual((await e.setupLinter()).action, 'shadowed'); assert.deepStrictEqual(s.calls.updates, []); assert.match(s.calls.warns[0], /wins over user settings/);
      await e.maybeOfferLinter(); assert.deepStrictEqual(s.calls.updates, []); assert.strictEqual(c._gs[OWNED], undefined);
    }
  });
  await t('linter: a pre-set other value is kept; a user change after setup is left by stop; an older install path of ours is updated', async () => {
    const c2 = ctx('/ext dir'); const s2 = stub({ verilog: { 'linting.linter': 'iverilog', 'linting.path': '/pre' } }); const e2 = ext.createExtension(s2, c2, {});
    assert.strictEqual((await e2.setupLinter()).action, 'kept'); assert.deepStrictEqual(s2.calls.updates, []); assert.match(s2.calls.warns[0], /left as it is/);
    assert.strictEqual((await e2.removeLinter()).action, 'none'); assert.deepStrictEqual(s2.calls.updates, []);
    const c = ctx('/ext dir'); const s = stub({ verilog: {} }); const e = ext.createExtension(s, c, {});
    await e.setupLinter(); await s.workspace.getConfiguration('verilog').update('linting.path', '/their/own', 1);
    assert.deepStrictEqual(await e.removeLinter(), { action: 'left', value: '/their/own' });
    assert.strictEqual(s.calls.updates.at(-1)[2], '/their/own'); assert.strictEqual(c._gs[OWNED], undefined);
    const c3 = ctx('/ext 0.2/dir'); c3._gs[OWNED] = { value: '/ext 0.1/dir/bin', previous: '' };
    const s3 = stub({ verilog: { 'linting.path': '/ext 0.1/dir/bin' } }); const e3 = ext.createExtension(s3, c3, {});
    assert.deepStrictEqual(await e3.setupLinter(), { action: 'set', value: '/ext 0.2/dir/bin', previous: '' });
    assert.deepStrictEqual(c3._gs[OWNED], { value: '/ext 0.2/dir/bin', previous: '' });
    assert.deepStrictEqual(await e3.removeLinter(), { action: 'restored', value: '' });
  });
  await t('activation never mutates settings: offer only when setup would write, "Not now" remembered', async () => {
    const c = ctx(); const s = stub({ verilog: { 'linting.linter': 'iverilog' }, answer: 'Not now' }); const e = ext.createExtension(s, c, {});
    await e.maybeOfferLinter(); assert.deepStrictEqual(s.calls.updates, []); assert.strictEqual(c._gs['dewfpga.lintingPromptDeclined'], true);
    await e.maybeOfferLinter(); assert.strictEqual(s.calls.infos.length, 1);
    const s2 = stub({ verilog: {} }); await ext.createExtension(s2, ctx(), {}).maybeOfferLinter(); assert.strictEqual(s2.calls.infos.length, 0); // linter none: silent
    const s4 = stub({ verilog: { 'linting.linter': 'iverilog', 'linting.path': '/pre' } }); await ext.createExtension(s4, ctx(), {}).maybeOfferLinter(); assert.strictEqual(s4.calls.infos.length, 0);
    const s3 = stub({ verilog: { 'linting.linter': 'iverilog', 'linting.path': '' }, answer: 'Set up' }); const c3 = ctx('/e'); await ext.createExtension(s3, c3, {}).maybeOfferLinter();
    assert.deepStrictEqual(s3.calls.updates, [['verilog', 'linting.path', '/e/bin']]); assert.deepStrictEqual(c3._gs[OWNED], { value: '/e/bin', previous: '' });
  });
  // --- the shim, real iverilog ---
  const shim = path.join(ROOT, 'vscode', 'bin', 'iverilog');
  const haveIverilog = spawnSync('iverilog', ['-V']).status === 0;
  const lintArgs = ['-t', 'null', '-g2012', '-y', '.', '-Y', '.sv', '-Y', '.v'];
  const envShimFirst = Object.assign({}, process.env, { PATH: path.dirname(shim) + ':' + process.env.PATH });
  await t('shim: constant-select sorry -> warning, exit 0, stdout untouched; veriloghdl parser reads it as Warning', () => {
    assert.ok(haveIverilog, 'iverilog is required for actual shim validation');
    const r = spawnSync(shim, [...lintArgs, 'constsel.sv'], { cwd: FX, encoding: 'utf8', env: envShimFirst });
    const real = spawnSync('iverilog', [...lintArgs, 'constsel.sv'], { cwd: FX, encoding: 'utf8' });
    assert.strictEqual(real.status, 0); assert.match(real.stderr, /^constsel\.sv:3: sorry: constant selects in always_\* processes/m);
    assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout, real.stdout);
    assert.strictEqual(r.stderr, real.stderr.replace(/: sorry: constant selects/g, ': warning: constant selects'));
    assert.ok(!/sorry/.test(r.stderr));
    // veriloghdl 1.29.0 dist/extension.js: ^(file):(line):\s*(?:(error|warning|note):\s*)?(msg); warning->Warning, else Error
    const vh = /^(.+?):(\d+):\s*(?:(error|warning|note):\s*)?(.*)$/;
    const m = vh.exec(r.stderr.split('\n')[0]); assert.strictEqual(m[3], 'warning');
    assert.strictEqual(vh.exec(real.stderr.split('\n')[0])[3], undefined); // real: 'sorry' is not a severity -> Error
  });
  await t('shim: syntax error -> same lines and exit as real iverilog; clean file -> empty, exit 0', () => {
    assert.ok(haveIverilog, 'iverilog is required for actual shim validation');
    for (const f of ['syntax.sv', 'clean.sv']) {
      const r = spawnSync(shim, [...lintArgs, f], { cwd: FX, encoding: 'utf8', env: envShimFirst });
      const real = spawnSync('iverilog', [...lintArgs, f], { cwd: FX, encoding: 'utf8' });
      assert.strictEqual(r.status, real.status, f); assert.strictEqual(r.stderr, real.stderr, f); assert.strictEqual(r.stdout, real.stdout, f);
    }
    assert.notStrictEqual(spawnSync('iverilog', [...lintArgs, 'syntax.sv'], { cwd: FX }).status, 0);
  });
  await t('shim: -V passes stdout through with exit 0; no iverilog on PATH -> exit 127', () => {
    assert.ok(haveIverilog, 'iverilog is required for actual shim validation');
    const r = spawnSync(shim, ['-V'], { encoding: 'utf8', env: envShimFirst }); assert.strictEqual(r.status, 0); assert.match(r.stdout, /Icarus Verilog version/);
    // minimal PATH (only the shim folder, as a GUI-launched VS Code may give): the fallback dirs still find iverilog
    const r2 = spawnSync('/bin/bash', ['-c', 'PATH="$1" exec "$2" -V', '_', path.dirname(shim), shim], { encoding: 'utf8' });
    assert.strictEqual(r2.status, 0, r2.stderr); assert.match(r2.stdout, /Icarus Verilog version/); assert.strictEqual(r2.stderr, '');
    // a copy whose fallback dirs do not exist, on a PATH without iverilog: exit 127 with the fix line, nothing else
    const nd = fs.mkdtempSync(path.join(os.tmpdir(), 'no iverilog ')); const copy = path.join(nd, 'iverilog');
    fs.writeFileSync(copy, fs.readFileSync(shim, 'utf8').replace(/\/opt\/homebrew\/bin \/usr\/local\/bin/, nd + '/none ' + nd + '/none2'), { mode: 0o755 });
    const r3 = spawnSync('/bin/bash', ['-c', 'PATH="$1" exec "$2" -V', '_', nd, copy], { encoding: 'utf8' });
    assert.strictEqual(r3.status, 127); assert.match(r3.stderr, /brew install icarus-verilog/); assert.strictEqual(r3.stdout, '');
  });
  // shim found on PATH again: run with a hard timeout in its own process group, killed whole if it hangs
  function bounded(file, args, env, ms) {
    const r = spawnSync('python3', ['-c', [
      'import os,signal,subprocess,sys',
      'p=subprocess.Popen(sys.argv[2:],env=dict(os.environ),stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)',
      'try:',
      '  o,e=p.communicate(timeout=float(sys.argv[1]))',
      'except subprocess.TimeoutExpired:',
      '  os.killpg(p.pid,signal.SIGKILL); p.communicate(); sys.stdout.write("TIMEOUT"); sys.exit(0)',
      'sys.stdout.write("%d\\n" % p.returncode); sys.stdout.flush(); sys.stdout.buffer.write(o + b"\\0" + e)',
    ].join('\n'), String(ms / 1000), file, ...args], { env, encoding: 'utf8', timeout: ms + 5000 });
    if (r.stdout === 'TIMEOUT') return { timeout: true };
    const nl = r.stdout.indexOf('\n'), rest = r.stdout.slice(nl + 1), z = rest.indexOf('\0');
    return { status: Number(r.stdout.slice(0, nl)), stdout: rest.slice(0, z), stderr: rest.slice(z + 1) };
  }
  await t('shim: itself on PATH again (two symlinks, symlink as $0, hard link, identical copy) -> real iverilog, no loop; edited copy -> 127', () => {
    assert.ok(haveIverilog, 'iverilog is required for actual shim validation');
    const realV = spawnSync('iverilog', ['-V'], { encoding: 'utf8' });
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shim loop '));
    const dir = (n) => { fs.mkdirSync(path.join(base, n)); return path.join(base, n); };
    const A = dir('a'), B = dir('b'), H = dir('h'), C = dir('c'), E = dir('e');
    fs.symlinkSync(shim, path.join(A, 'iverilog')); fs.symlinkSync(shim, path.join(B, 'iverilog'));
    fs.linkSync(shim, path.join(H, 'iverilog')); fs.copyFileSync(shim, path.join(C, 'iverilog')); fs.chmodSync(path.join(C, 'iverilog'), 0o755);
    fs.writeFileSync(path.join(E, 'iverilog'), fs.readFileSync(shim, 'utf8') + '# edited\n', { mode: 0o755 });
    const sys = process.env.PATH;
    const env = (p) => ({ PATH: p, HOME: process.env.HOME, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C' });
    for (const [what, file, p] of [
      ['two symlinks on PATH', path.join(A, 'iverilog'), `${A}:${B}:${sys}`],
      ['the shim, then a symlink to it', shim, `${A}:${path.dirname(shim)}:${sys}`],
      ['hard link on PATH', shim, `${H}:${sys}`],
      ['identical copy on PATH', shim, `${C}:${sys}`],
    ]) {
      const r = bounded(file, ['-V'], env(p), 3000);
      assert.ok(!r.timeout, what + ': hung');
      assert.deepStrictEqual([r.status, r.stdout, r.stderr], [realV.status, realV.stdout, realV.stderr], what);
    }
    const r = bounded(shim, ['-V'], env(`${E}:${sys}`), 3000);
    assert.ok(!r.timeout, 'edited copy: hung');
    assert.strictEqual(r.status, 127); assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr, `iverilog: a second dewfpga lint shim (${path.join(fs.realpathSync(E), 'iverilog')}) was on PATH before the real iverilog. Fix: keep one dewfpga shim folder on PATH, or brew install icarus-verilog\n`);
    fs.rmSync(base, { recursive: true, force: true });
  });
  // --- vsix ---
  await t('vsix: two builds identical, required members, shim executable, manifest metadata', () => {
    const o1 = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix1')), o2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix2'));
    execFileSync('python3', [path.join(ROOT, 'vscode', 'build-vsix.py'), '--out', o1]); execFileSync('python3', [path.join(ROOT, 'vscode', 'build-vsix.py'), '--out', o2]);
    const a = fs.readFileSync(path.join(o1, 'dewfpga-0.1.0.vsix')), b = fs.readFileSync(path.join(o2, 'dewfpga-0.1.0.vsix'));
    assert.ok(a.equals(b), 'identical bytes'); assert.ok(a.length > 5000);
    const list = execFileSync('unzip', ['-Z1', path.join(o1, 'dewfpga-0.1.0.vsix')], { encoding: 'utf8' }).trim().split('\n');
    assert.deepStrictEqual(list, ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/LICENSE', 'extension/README.md', 'extension/bin/iverilog', 'extension/extension.js', 'extension/package.json']);
    const long = execFileSync('unzip', ['-Z', path.join(o1, 'dewfpga-0.1.0.vsix')], { encoding: 'utf8' });
    assert.match(long, /^-rwxr-xr-x .*extension\/bin\/iverilog$/m);
    const man = execFileSync('unzip', ['-p', path.join(o1, 'dewfpga-0.1.0.vsix'), 'extension.vsixmanifest'], { encoding: 'utf8' });
    assert.match(man, /Identity Language="en-US" Id="dewfpga" Version="0.1.0" Publisher="nosey-dewdrop"/); assert.match(man, /<License>extension\/LICENSE<\/License>/);
    const lic = execFileSync('unzip', ['-p', path.join(o1, 'dewfpga-0.1.0.vsix'), 'extension/LICENSE'], { encoding: 'utf8' }); assert.match(lic, /^MIT License/);
    assert.ok(!/\/Users\//.test(a.toString('latin1')), 'no personal path inside the vsix');
  });
  fs.rmSync(path.dirname(fakeCli), { recursive: true, force: true }); fs.rmSync(wdir, { recursive: true, force: true }); fs.rmSync(proj, { recursive: true, force: true });
  console.log(`passed ${passed}, failed ${failed}`); process.exit(failed ? 1 : 0);
})();
