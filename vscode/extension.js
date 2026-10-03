'use strict';
// dewfpga VS Code extension. Plain JS, no runtime dependencies.
// Everything that can be tested without VS Code lives in `lib`; activate() wires it to the API.
const path = require('path');
const fs = require('fs');
const os = require('os');
const childProcess = require('child_process');

// Same regexp as contributes.problemMatchers[0].pattern.regexp in package.json (the test checks they match).
// VS Code maps the severity group case-insensitively: ERROR -> Error, warning -> Warning, note -> Info
// (problemMatcher.ts getSeverity; 'note' is an explicit alias of Info). The matcher's own `severity: "info"`
// is only the fallback for a value VS Code does not know.
const MATCHER_REGEXP = '^(.+?):(\\d+): (ERROR|warning|note) \\[([a-z0-9-]+)\\]: (.*)$';
const SEVERITY = { ERROR: 'error', warning: 'warning', note: 'info' };

function parseDiagnostic(line) {
  const m = new RegExp(MATCHER_REGEXP).exec(line);
  if (!m) return null;
  return { file: m[1], line: Number(m[2]), severity: SEVERITY[m[3]], code: m[4], message: m[5] };
}

// `dewfpga tops` prints `<module>\t<file>` per candidate, project top first, nothing else.
function parseTops(stdout) {
  const out = [];
  for (const raw of String(stdout).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    out.push({ module: line.slice(0, tab), file: line.slice(tab + 1) });
  }
  return out;
}

// 0 or 1 candidate: hand '' to the CLI, which prints its own auto/top line (same output as the terminal).
// 2+: ask; the remembered module is preselected only while it is still a candidate.
function chooseTop(candidates, remembered) {
  if (candidates.length < 2) return { action: 'auto', top: '' };
  const idx = remembered ? candidates.findIndex((c) => c.module === remembered) : -1;
  return { action: 'ask', preselect: idx >= 0 ? idx : undefined, stale: Boolean(remembered) && idx < 0 };
}

const FALLBACK_CLI = (home) => [
  '/opt/homebrew/bin/dewfpga',
  '/usr/local/bin/dewfpga',
  path.join(home, '.dewfpga', 'bin', 'dewfpga'), // site/install's default DEWFPGA_DIR
  path.join(home, 'fpga', 'dewfpga', 'bin', 'dewfpga'),
];

// Returns {cli} or {error}. The setting must be absolute: VS Code's process has no terminal PATH.
function resolveCliPath(configured, exists, home) {
  const v = (configured || '').trim();
  if (v) {
    if (!path.isAbsolute(v)) return { error: `dewfpga.cliPath must be an absolute path (got "${v}"); VS Code does not see your terminal's PATH.` };
    if (!exists(v)) return { error: `dewfpga.cliPath points at "${v}", and there is no file there. Fix: dewfpga install, or set dewfpga.cliPath to where dewfpga is.` };
    return { cli: v };
  }
  for (const c of FALLBACK_CLI(home)) if (exists(c)) return { cli: c };
  return { error: 'dewfpga was not found at /opt/homebrew/bin/dewfpga, /usr/local/bin/dewfpga, ~/.dewfpga/bin/dewfpga or ~/fpga/dewfpga/bin/dewfpga. Fix: run `dewfpga install` in a terminal, or set dewfpga.cliPath (absolute) in Settings.' };
}

// Which folder a shell task ran in. Resolved when the task STARTS (the editor may change before it ends).
// cwd with ${fileDirname} -> the active editor's folder at start; ${workspaceFolder} -> the task's folder;
// absolute literal -> as is; anything else unresolved -> task folder, else the editor's folder.
function resolveTaskFolder(cwdOption, activeFile, scopeFolder) {
  const editorDir = activeFile ? path.dirname(activeFile) : undefined;
  if (cwdOption && typeof cwdOption === 'string') {
    let c = cwdOption;
    if (c.includes('${fileDirname}')) { if (!editorDir) return undefined; c = c.split('${fileDirname}').join(editorDir); }
    if (c.includes('${workspaceFolder}')) { if (!scopeFolder) return undefined; c = c.split('${workspaceFolder}').join(scopeFolder); }
    if (c.includes('${')) return undefined;
    if (path.isAbsolute(c)) return path.normalize(c);
    return scopeFolder ? path.resolve(scopeFolder, c) : undefined;
  }
  return scopeFolder || editorDir;
}

// 'cli' (dewfpga sim: the CLI moves to the Vivado project root first), 'make' (make sim: runs where it
// starts), or null. A task named "dewfpga/FPGA: simulate" whose command is neither counts as 'cli'.
function simTaskKind(task) {
  if (!task) return null;
  const ex = task.execution || {};
  const cmd = typeof ex.commandLine === 'string' ? ex.commandLine : [ex.command, ...(ex.args || [])].map(String).join(' ');
  if (/(^|[\s/])dewfpga\s+sim(\s|$)/.test(cmd)) return 'cli';
  if (/(^|\s)make\s+sim(\s|$)/.test(cmd)) return 'make';
  if (/^(dewfpga|FPGA): simulate\b/.test(task.name || '')) return 'cli';
  return null;
}
function isSimTask(task) { return simTaskKind(task) !== null; }

// The folder the CLI works in, the same walk as locate() in bin/dewfpga (kept in step by the parity test
// against the real CLI): up to 7 folders from `dir`; the first with exactly one *.xpr, or with a
// *.srcs/sources_1 folder, is the project root; two or more *.xpr is the CLI's two-vivado-projects error.
// It climbs only while the folder is <name>.srcs or inside one, never past `home` or /. No project: `dir`.
// Names starting with a dot are skipped, as bash's * skips them. Returns {root} or {error}.
function projectRoot(dir, home, fsLike) {
  const f = fsLike || fs;
  const list = (d) => { try { return f.readdirSync(d).filter((n) => !n.startsWith('.')).sort(); } catch (e) { return []; } };
  const is = (p, kind) => { try { const st = f.statSync(p); return kind === 'dir' ? st.isDirectory() : st.isFile(); } catch (e) { return false; } };
  let d = dir;
  for (let i = 0; i <= 6; i++) {
    const names = list(d);
    const xprs = names.filter((n) => n.endsWith('.xpr') && is(path.join(d, n), 'file'));
    if (xprs.length > 1) return { error: `${xprs.length} Vivado projects in ${d} (${xprs.join(' ')})` };
    if (xprs.length === 1) return { root: d };
    if (names.some((n) => n.endsWith('.srcs') && is(path.join(d, n, 'sources_1'), 'dir'))) return { root: d };
    if (!(d.endsWith('.srcs') || d.includes('.srcs/'))) break;
    if (d === home || d === '/') break;
    d = path.dirname(d);
  }
  return { root: dir };
}

// Waveform freshness without clocks: the *.vcd files directly in `dir` are recorded when the task
// starts (device, inode, size, mtime and ctime in ns where the file system has them, plus a sha256 of
// files up to 16 MiB) and compared when it ends. A file is fresh when it is new, or when any of those
// differ. An untouched old file is never fresh, whatever its timestamp. Only `dir` itself is read:
// a $dumpfile into a subfolder or an absolute path is not looked for.
const HASH_LIMIT = 16 << 20;
function vcdState(full, f) {
  let st;
  try { st = f.statSync(full, { bigint: true }); } catch (e) { return null; }
  if (!st.isFile()) return null;
  const key = [st.dev, st.ino, st.size, st.mtimeNs !== undefined ? st.mtimeNs : st.mtimeMs, st.ctimeNs !== undefined ? st.ctimeNs : st.ctimeMs].map(String).join(':');
  let hash = null;
  if (Number(st.size) <= HASH_LIMIT) {
    try { hash = require('crypto').createHash('sha256').update(f.readFileSync(full)).digest('hex'); } catch (e) { hash = null; }
  }
  return { key, hash, mtime: Number(st.mtimeMs) };
}
function snapshotVcds(dir, fsLike) {
  const f = fsLike || fs;
  const snap = {};
  let names;
  try { names = f.readdirSync(dir); } catch (e) { return snap; }
  for (const name of names) {
    if (!name.endsWith('.vcd')) continue;
    const st = vcdState(path.join(dir, name), f);
    if (st) snap[name] = st;
  }
  return snap;
}
// The fresh *.vcd of `dir` against `before` (snapshotVcds at the start); newest mtime wins, then name. null: none.
function pickFreshVcd(dir, before, fsLike) {
  const after = snapshotVcds(dir, fsLike);
  let best = null;
  for (const name of Object.keys(after).sort()) {
    const a = after[name], b = before && before[name];
    if (b && b.key === a.key && b.hash === a.hash) continue;
    if (!best || a.mtime > best.mtime) best = { path: path.join(dir, name), mtime: a.mtime };
  }
  return best ? best.path : null;
}

// Linter shim ownership. `inspect` is getConfiguration('verilog').inspect('linting.path'). The user
// setting is written only when it is unset or '', and ownership ({value, previous}) is recorded only for a
// value this extension wrote; removal puts `previous` back (unset or ''). A value equal to the shim
// that was already there is not ours. A workspace or folder value wins over the user setting, so with
// one present nothing is written.
// setup: {action: 'set'|'already'|'not-ours'|'kept'|'shadowed', value, previous?}
// removal: {action: 'restored'|'left'|'none', value?}
function planLinterSetup(inspect, shimDir, owned) {
  const i = inspect || {};
  const local = i.workspaceFolderValue !== undefined ? i.workspaceFolderValue : i.workspaceValue;
  if (local !== undefined) return { action: 'shadowed', value: local };
  const g = i.globalValue;
  if (owned && g === owned.value) {
    if (g === shimDir) return { action: 'already', value: shimDir };
    return { action: 'set', value: shimDir, previous: owned.previous }; // our older install path (the folder name has the version)
  }
  if (g === undefined || g === '') return { action: 'set', value: shimDir, previous: g };
  if (g === shimDir) return { action: 'not-ours', value: g };
  return { action: 'kept', value: g };
}
function planLinterRemoval(inspect, owned) {
  if (!owned) return { action: 'none' };
  const g = (inspect || {}).globalValue;
  if (g === owned.value) return { action: 'restored', value: owned.previous };
  return { action: 'left', value: g };
}

// One choice from `items` through createQuickPick (QuickPickOptions has no activeItems; a QuickPick does).
// `active` (one of `items`, or undefined) is the highlighted row. Resolves to the accepted item, or
// undefined when the pick is hidden (Escape, focus elsewhere) before an accept. Resolves once; disposes the pick.
function pickOne(vscode, items, placeholder, active) {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick();
    let done = false;
    const subs = [];
    const finish = (value) => {
      if (done) return;
      done = true;
      for (const s of subs) s.dispose();
      qp.dispose();
      resolve(value);
    };
    qp.items = items;
    qp.placeholder = placeholder;
    qp.ignoreFocusOut = true;
    qp.canSelectMany = false;
    if (active !== undefined) qp.activeItems = [active];
    subs.push(qp.onDidAccept(() => {
      const it = qp.selectedItems[0] || qp.activeItems[0];
      if (it) finish(it); // Enter on an empty filter result accepts nothing; the pick stays open
    }));
    subs.push(qp.onDidHide(() => finish(undefined)));
    qp.show();
  });
}

function runTops(cli, cwd, execFile) {
  return new Promise((resolve) => {
    (execFile || childProcess.execFile)(cli, ['tops'], { cwd, env: process.env, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err && typeof err.code === 'string' ? err : null });
    });
  });
}

// Builds the extension against a vscode-like API (the real one in activate, a stub in tests).
function createExtension(vscode, context, deps) {
  const d = Object.assign({ execFile: childProcess.execFile, fs, home: os.homedir() }, deps || {});
  const exists = (p) => { try { d.fs.accessSync(p); return true; } catch (e) { return false; } };
  const REMEMBER = 'dewfpga.topByFolder';
  const OWNED = 'dewfpga.lintingPathOwnership'; // {value, previous}; the 0.x key 'dewfpga.lintingPathOwned' is not read
  const DECLINED = 'dewfpga.lintingPromptDeclined';
  const shimDir = path.join(context.extensionPath, 'bin');

  function currentFolder() {
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document && ed.document.uri && ed.document.uri.scheme === 'file') return path.dirname(ed.document.uri.fsPath);
    const wf = vscode.workspace.workspaceFolders;
    if (wf && wf.length) return wf[0].uri.fsPath;
    return undefined;
  }

  // Command input for tasks: a string (top module or '' for auto) runs the task; undefined cancels it.
  async function pickTop() {
    const folder = currentFolder();
    if (!folder) { vscode.window.showErrorMessage('dewfpga: open a .sv file (or a folder) first, so I know which folder to build.'); return undefined; }
    const cfg = vscode.workspace.getConfiguration('dewfpga').get('cliPath', '');
    const r = resolveCliPath(cfg, exists, d.home);
    if (r.error) { vscode.window.showErrorMessage('dewfpga: ' + r.error); return undefined; }
    const res = await runTops(r.cli, folder, d.execFile);
    if (res.error) { vscode.window.showErrorMessage(`dewfpga: could not run ${r.cli}: ${res.error.message}`); return undefined; }
    if (res.code !== 0) { vscode.window.showErrorMessage('dewfpga tops failed: ' + (res.stderr.trim().split('\n')[0] || `exit ${res.code}`)); return undefined; }
    const candidates = parseTops(res.stdout);
    // keyed by the project root, so sources_1/new and sim_1/new share one remembered top
    const key = projectRoot(folder, d.home, d.fs).root || folder;
    const memory = context.workspaceState.get(REMEMBER, {});
    const remembered = memory[key];
    const choice = chooseTop(candidates, remembered);
    if (choice.action === 'auto') {
      if (remembered !== undefined) { delete memory[key]; await context.workspaceState.update(REMEMBER, memory); }
      return '';
    }
    const items = candidates.map((c) => ({ label: c.module, description: c.file, module: c.module }));
    const picked = await pickOne(vscode, items,
      choice.stale
        ? `Two or more modules could be the top (${remembered} is no longer one of them). Which one goes on the board?`
        : 'Two or more modules could be the top. Which one goes on the board?',
      choice.preselect !== undefined ? items[choice.preselect] : undefined);
    if (!picked) {
      if (choice.stale) { delete memory[key]; await context.workspaceState.update(REMEMBER, memory); }
      return undefined; // Escape: the task does not run
    }
    memory[key] = picked.module;
    await context.workspaceState.update(REMEMBER, memory);
    return picked.module;
  }

  async function forgetTop() {
    const folder = currentFolder();
    const key = folder && (projectRoot(folder, d.home, d.fs).root || folder);
    const memory = context.workspaceState.get(REMEMBER, {});
    if (key && memory[key] !== undefined) { delete memory[key]; await context.workspaceState.update(REMEMBER, memory); vscode.window.showInformationMessage(`dewfpga: forgot the top for ${key}.`); }
    else vscode.window.showInformationMessage('dewfpga: nothing remembered for this folder.');
  }

  function lintConfig() { return vscode.workspace.getConfiguration('verilog'); }
  function lintInspect() { return lintConfig().inspect('linting.path') || {}; }

  async function setupLinter() {
    const plan = planLinterSetup(lintInspect(), shimDir, context.globalState.get(OWNED));
    if (plan.action === 'set') {
      await lintConfig().update('linting.path', shimDir, vscode.ConfigurationTarget.Global);
      await context.globalState.update(OWNED, { value: shimDir, previous: plan.previous });
      vscode.window.showInformationMessage(`dewfpga: verilog.linting.path is now ${shimDir} (user settings). "dewfpga: stop using the dewfpga iverilog lint shim" puts the old value back.`);
    } else if (plan.action === 'already') {
      vscode.window.showInformationMessage('dewfpga: the lint shim is already in use.');
    } else if (plan.action === 'not-ours') {
      vscode.window.showInformationMessage(`dewfpga: verilog.linting.path is already ${shimDir}; it was set outside this extension, so the stop command will leave it.`);
    } else if (plan.action === 'shadowed') {
      vscode.window.showWarningMessage(`dewfpga: this workspace sets verilog.linting.path to ${JSON.stringify(plan.value)}, which wins over user settings; nothing changed. Set it to ${shimDir} there yourself if you want the shim.`);
    } else {
      vscode.window.showWarningMessage(`dewfpga: verilog.linting.path is already set to ${plan.value}; left as it is. Set it to ${shimDir} yourself if you want the shim.`);
    }
    return plan;
  }

  async function removeLinter() {
    const plan = planLinterRemoval(lintInspect(), context.globalState.get(OWNED));
    if (plan.action === 'restored') {
      await lintConfig().update('linting.path', plan.value, vscode.ConfigurationTarget.Global);
      await context.globalState.update(OWNED, undefined);
      vscode.window.showInformationMessage(plan.value === undefined ? 'dewfpga: verilog.linting.path removed from user settings (it was unset before).' : 'dewfpga: verilog.linting.path is "" again, as it was before.');
    } else if (plan.action === 'left') {
      await context.globalState.update(OWNED, undefined);
      vscode.window.showInformationMessage(`dewfpga: verilog.linting.path is ${plan.value}, not the value this extension wrote; left as it is.`);
    } else vscode.window.showInformationMessage('dewfpga: the lint shim was never set up by this extension; nothing to remove.');
    return plan;
  }

  // Never changes a setting by itself: offers once, when the linter is iverilog and setup would write.
  async function maybeOfferLinter() {
    if (context.globalState.get(OWNED) || context.globalState.get(DECLINED)) return;
    const linter = lintConfig().get('linting.linter');
    if (linter !== 'iverilog' || planLinterSetup(lintInspect(), shimDir, undefined).action !== 'set') return;
    const pick = await vscode.window.showInformationMessage('dewfpga: show Icarus\'s "sorry: constant selects" as a warning instead of a red error? This sets verilog.linting.path in your user settings.', 'Set up', 'Not now');
    if (pick === 'Set up') await setupLinter();
    else if (pick === 'Not now') await context.globalState.update(DECLINED, true);
  }

  // Waveform: when a sim task starts, record the *.vcd files of the folder the simulation runs in (the
  // project root for `dewfpga sim`, the task's cwd for `make sim`); when it ends with 0, open the one that
  // is new or changed.
  const started = new Map();
  function onTaskStart(e) {
    const task = e.execution && e.execution.task;
    const kind = simTaskKind(task);
    if (!kind) return;
    const ed = vscode.window.activeTextEditor;
    const active = ed && ed.document && ed.document.uri.scheme === 'file' ? ed.document.uri.fsPath : undefined;
    const scope = task.scope && task.scope.uri ? task.scope.uri.fsPath : (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined);
    const cwd = task.execution && task.execution.options ? task.execution.options.cwd : undefined;
    let folder = resolveTaskFolder(cwd, active, scope);
    if (folder && kind === 'cli') folder = projectRoot(folder, d.home, d.fs).root || folder;
    started.set(e.execution, { folder, before: folder ? snapshotVcds(folder, d.fs) : {} });
  }
  async function onTaskEnd(e) {
    const rec = started.get(e.execution);
    if (!rec) return;
    started.delete(e.execution);
    if (e.exitCode !== 0 || !rec.folder) return;
    const vcd = pickFreshVcd(rec.folder, rec.before, d.fs);
    if (!vcd) { vscode.window.setStatusBarMessage(`dewfpga: no new or changed .vcd directly in ${rec.folder} (a $dumpfile into another folder is not opened)`, 8000); return; }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(vcd));
    return vcd;
  }

  const subs = [
    vscode.commands.registerCommand('dewfpga.pickTop', pickTop),
    vscode.commands.registerCommand('dewfpga.forgetTop', forgetTop),
    vscode.commands.registerCommand('dewfpga.setupLinter', setupLinter),
    vscode.commands.registerCommand('dewfpga.removeLinter', removeLinter),
    vscode.tasks.onDidStartTaskProcess(onTaskStart),
    vscode.tasks.onDidEndTaskProcess(onTaskEnd),
  ];
  for (const s of subs) context.subscriptions.push(s);
  return { pickTop, forgetTop, setupLinter, removeLinter, onTaskStart, onTaskEnd, maybeOfferLinter, shimDir };
}

function activate(context) {
  // eslint-disable-next-line global-require
  const vscode = require('vscode');
  const ext = createExtension(vscode, context);
  ext.maybeOfferLinter().catch(() => {});
  return ext;
}
function deactivate() {}

module.exports = { activate, deactivate, createExtension, lib: { MATCHER_REGEXP, SEVERITY, parseDiagnostic, parseTops, chooseTop, resolveCliPath, resolveTaskFolder, simTaskKind, isSimTask, projectRoot, snapshotVcds, pickFreshVcd, planLinterSetup, planLinterRemoval, pickOne, runTops } };
