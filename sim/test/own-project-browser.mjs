// a student's own project, no lab names (fixtures/own-project.mjs), taken through the page the way a student does:
// the real folder picker input, real switch clicks, pause/step buttons, typing in CodeMirror, reload, the download
// button. the real yosys worker compiles and DigitalJS runs. expected LEDs come from arithmetic here (step * n mod
// 256), not from the engine. a separate two-file design arrives through a DataTransfer drop event dispatched by the
// test: a browser drop event, not an OS drag.
// run by test/run-e2e.mjs against its preview (BASE); alone, it builds and previews by itself.
//   BROWSER (chromium|webkit|firefox), E2E_EXECUTABLE as in test/e2e.mjs
//   OWN_PROJECT_ZIP=path keeps the downloaded zip; `node own-project-browser.mjs --cli path` unzips it and runs the
//   real CLI sim (the fixture's own bench) and bit on it (native tools; not part of the browser runner).
import { build, preview } from 'vite';
import { chromium, webkit, firefox } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { ownProject, pkg, LED } from './fixtures/own-project.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const repo = fileURLToPath(new URL('../../', import.meta.url));
const sources = ownProject.filter((r) => !r.path.startsWith('.Xil/'));
const finalText = (r) => r.path === 'pkg/stepper_pkg.sv' ? pkg(5) : r.text;
const sh = (args, cwd) => {
  const p = spawnSync(args[0], args.slice(1), { cwd, env: { ...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C', PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8', timeout: 150000 });
  assert.equal(p.status, 0, `${args.join(' ')}\n${p.error || ''}\n${p.stdout}\n${p.stderr}`);
  return p.stdout + p.stderr;
};

if (process.argv[2] === '--cli') {
  const temp = mkdtempSync(join(tmpdir(), 'dewfpga-own-cli-'));
  try {
    const project = join(temp, 'project');
    sh(['python3', '-B', '-c', `import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, resolve(process.argv[3]), project], temp);
    for (const r of sources) assert.equal(readFileSync(join(project, r.path), 'utf8'), finalText(r), r.path);
    const info = sh(['python3', '-B', join(repo, 'templates/check_xdc.py'), '--xpr', 'dewfpga-workspace.xpr'], project);
    assert.match(info, /^TOP=stepper_top$/m); assert.match(info, /^SIMTOP=stepper_tb$/m); assert.match(info, /^XDC=constraints\/board.xdc$/m);
    const cli = process.env.DEWFPGA_TEST_CLI || join(repo, 'bin/dewfpga');
    const sim = sh([cli, 'sim'], project); assert.match(sim, /PASS own stepper: reset, 60 enabled steps of 5 with wrap, hold with enable off/);
    const bit = sh([cli, 'bit'], project); assert.match(bit, /pnr ok/);
    assert.ok(existsSync(join(project, 'stepper_top.bit')));
    console.log(sim.trim()); console.log(bit.trim());
    console.log(info.trim().split('\n').filter((l) => /^(TOP|SIMTOP|XDC)=/.test(l)).join(' '));
    console.log('PASS own project CLI: downloaded files byte-exact; top/bench/XDC from the manifest; real sim bench passes; bitstream built (not flashed)');
  } finally { rmSync(temp, { recursive: true, force: true }); }
  process.exit(0);
}

const browserName = process.env.BROWSER || 'chromium';
const type = { chromium, webkit, firefox }[browserName];
if (!type) throw new Error(`unsupported BROWSER=${browserName}`);
const launch = { headless: !process.env.E2E_HEADED };
if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
let server = null, browser;
const temp = mkdtempSync(join(tmpdir(), 'dewfpga-own-'));
if (!process.env.BASE) {
  await build({ root, logLevel: 'error' });
  server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
}
try {
  const base = process.env.BASE || `http://127.0.0.1:${server.httpServer.address().port}/`;
  browser = await type.launch(launch);
  console.log(`browser ${browserName} ${browser.version()}  base ${base}`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  page.on('dialog', (d) => d.accept());
  const idle = (re = /simulated clock|combinational|not running|error|press run/) => page.waitForFunction((src) =>
    window.dewfpga?.pendingRequests === 0 && new RegExp(src).test(document.querySelector('#status').textContent), re.source, { timeout: 120000 });
  const status = () => page.locator('#status').textContent();
  const leds = async (n = 8) => {
    const cls = await page.locator('#board .b-led').evaluateAll((els, n) => els.slice(0, n).map((e) => e.getAttribute('class')), n);
    return cls.reduce((v, c, i) => v | ((/\bon\b/.test(c) ? 1 : 0) << i), 0);
  };
  const sw = (i) => page.locator(`#board .b-sw[data-sw="${i}"]`).click();
  const swOn = (i) => page.locator(`#board .b-sw[data-sw="${i}"]`).getAttribute('aria-checked');
  const step = async () => { await page.locator('#step').click(); };
  const runButton = async () => { await page.waitForFunction(() => !document.querySelector('#run').disabled, null, { timeout: 60000 }); await page.locator('#run').click(); };
  const typeFile = async (tab, text) => {
    await page.locator(`.ftab[data-tab="${tab}"]`).click();
    await page.locator('#editors .editor:not([hidden]) .cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(text);
  };
  const tabs = () => page.locator('#ftabs .ftab').evaluateAll((els) => els.map((e) => e.dataset.tab).sort());
  await page.goto(base);
  await idle();

  // 1. drop: a separate two-file design arrives through a DataTransfer drop on the editor side
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['module lamp_not(input logic a, output logic y);\n  assign y = ~a;\nendmodule\n'], 'lamp_not.sv'));
    dt.items.add(new File(['set_property -dict { PACKAGE_PIN V17 IOSTANDARD LVCMOS33 } [get_ports a]\nset_property -dict { PACKAGE_PIN U16 IOSTANDARD LVCMOS33 } [get_ports y]\n'], 'lamp_not.xdc'));
    const el = document.querySelector('.right');
    el.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
  });
  await page.waitForFunction(() => /lamp_not/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  await idle();
  assert.deepEqual(await tabs(), ['lamp_not.sv', 'lamp_not.xdc']);
  assert.match(await status(), /lamp_not · combinational/);
  assert.equal(await leds(1), 1, 'drop: switch 0 off, y = ~a lights LD0');
  await sw(0); assert.equal(await leds(1), 0, 'drop: switch 0 on turns LD0 off');
  console.log('PASS drop (automated DataTransfer event, not an OS drag): two files, combinational, LD0 = ~SW0 both ways');

  // 2. the folder picker: the real <input webkitdirectory>, a folder with vivado's .Xil leftovers
  const dir = join(temp, 'my-stepper');
  for (const r of ownProject) { mkdirSync(dirname(join(dir, r.path)), { recursive: true }); writeFileSync(join(dir, r.path), r.text); }
  await page.evaluate(() => document.querySelector('#folder-input').addEventListener('change', e => {
    window.pickerPaths = [...e.target.files].map(f => f.webkitRelativePath || f.name);
  }, { capture: true, once: true }));
  await page.setInputFiles('#folder-input', dir);
  await page.waitForFunction(() => /stepper_top/.test(document.querySelector('#status').textContent), null, { timeout: 120000 });
  await idle();
  assert.deepEqual(await tabs(), sources.map((r) => r.path).sort(), 'the folder imports its sources, not .Xil');
  const pickerPaths = await page.evaluate(() => window.pickerPaths);
  console.log('folder picker paths:', JSON.stringify(pickerPaths));
  console.log('folder import console:', await page.locator('#console').textContent());
  if (pickerPaths.some(p => p.includes('/.Xil/'))) {
    await page.waitForFunction(() => /files excluded/.test(document.querySelector('#console').textContent));
  } else {
    assert.equal(pickerPaths.length, sources.length, 'browser excludes the hidden directory before delivering the FileList');
  }
  const readNote = (await page.locator('#console').textContent()).match(/read with yosys-slang/)?.[0] || 'read with yosys';
  assert.match(await status(), /stepper_top · .*simulated clock/);
  assert.equal(await page.locator('#roles select.role-pick').count(), 0, 'one top, one XDC: nothing to pick');
  for (let i = 0; i < 8; i++) assert.match(await page.locator(`#board .b-ledg[data-led="${i}"]`).getAttribute('aria-label'), new RegExp(`^led LD${i} · led\\[${i}\\] · pin ${LED[i]}$`));
  assert.match(await page.locator('#board .b-sw[data-sw="0"]').getAttribute('aria-label'), /sw\[0\] · pin V17/);
  assert.match(await page.locator('#board .b-sw[data-sw="1"]').getAttribute('aria-label'), /sw\[1\] · pin V16/);

  // the expected sequence: q = (q + step) mod 256 when en, 0 when rst (rst first), held otherwise
  const journey = async (stepBy, label) => {
    if (await swOn(0) !== 'true') await sw(0);           // rst on
    if (await swOn(1) !== 'false') await sw(1);          // en off
    if (!/resume/.test(await page.locator('#pause').textContent())) await page.locator('#pause').click();
    await step(); assert.equal(await leds(), 0, `${label}: synchronous reset clears`);
    await sw(1); await step(); await step(); assert.equal(await leds(), 0, `${label}: reset wins over enable`);
    await sw(0);                                         // rst off, en on
    let q = 0; const seen = [];
    for (let n = 1; n <= 90; n++) { await step(); q = (q + stepBy) & 255; seen.push(await leds()); assert.equal(seen.at(-1), q, `${label}: enabled step ${n}`); }
    await sw(1);                                         // en off
    for (let n = 0; n < 4; n++) { await step(); assert.equal(await leds(), q, `${label}: enable off holds`); }
    await sw(0); await step(); assert.equal(await leds(), 0, `${label}: reset with enable off clears on the edge`);
    await sw(0);
    return seen;
  };
  const seen3 = await journey(3, 'step 3');
  assert.match(await status(), /stepper_top · stepped/);
  console.log(`PASS folder picker: 5 sources, .Xil left out, ${readNote}, LD0-7 = led[0..7] on ${LED.join(',')}, SW0/SW1 = rst/en; 90 steps of 3 with wrap (${seen3.slice(0, 6).join(',')} .. ${seen3.at(-1)}), hold, sync reset`);

  // 3. editing the package changes the hardware; the old circuit is gone until run
  await typeFile('pkg/stepper_pkg.sv', pkg(5));
  await page.waitForFunction(() => /workspace changed/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
  assert.equal(await page.locator('#board .b-led.on').count(), 0, 'edit clears the old LEDs');
  await runButton(); await idle();
  assert.match(await status(), /stepper_top · .*simulated clock/);
  const seen5 = await journey(5, 'step 5');
  assert.notDeepEqual(seen5, seen3);
  console.log(`PASS CodeMirror edit STEP 3 -> 5: old circuit dropped on the edit; after run 90 steps of 5 (${seen5.slice(0, 6).join(',')} .. ${seen5.at(-1)})`);

  // 4. a syntax error invalidates the circuit; fixing it recovers
  const accum = sources.find((r) => r.path === 'rtl/accum.sv').text;
  await typeFile('rtl/accum.sv', accum.replace("q <= q + STEP;", 'q <= q + STEP'));
  await page.waitForFunction(() => /workspace changed/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#run').disabled || window.dewfpga.lint?.hasErrors, null, { timeout: 60000 }).catch(() => {});
  await page.keyboard.press('ControlOrMeta+Enter'); await idle(/not running|error/);
  assert.equal(await page.locator('#board .b-led.on').count(), 0, 'no LED from the old circuit');
  const before = await leds(); await page.locator('#step').click(); assert.equal(await leds(), before, 'step does nothing without a circuit');
  console.log(`PASS syntax error: status "${(await status()).trim()}", no LEDs, step inert`);
  await typeFile('rtl/accum.sv', accum);
  await runButton(); await idle();
  assert.match(await status(), /stepper_top · .*simulated clock/);
  assert.deepEqual(await journey(5, 'recovered'), seen5);
  console.log('PASS fixed: run again, the same step-5 sequence');

  // 5. reload keeps the student's files, the edit included
  await page.reload(); await idle();
  assert.deepEqual(await tabs(), sources.map((r) => r.path).sort());
  await page.locator('.ftab[data-tab="pkg/stepper_pkg.sv"]').click();
  assert.match(await page.locator('#editors .editor:not([hidden]) .cm-content').innerText(), /8'd5/);
  if (!/simulated clock/.test(await status())) { await runButton(); await idle(); }
  await journey(5, 'reloaded');
  console.log('PASS reload: same 5 files, the edited package, the step-5 sequence');

  // 6. the download button: bytes and manifest
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  const zipPath = join(temp, dl.suggestedFilename()); await dl.saveAs(zipPath);
  assert.equal(dl.suggestedFilename(), 'stepper_top.zip');
  const out = join(temp, 'unzipped');
  sh(['python3', '-B', '-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', zipPath, out], temp);
  for (const r of sources) assert.deepEqual(readFileSync(join(out, r.path)), Buffer.from(finalText(r)), r.path);
  assert.ok(!existsSync(join(out, '.Xil')));
  const manifest = readFileSync(join(out, 'dewfpga-workspace.xpr'), 'utf8');
  assert.match(manifest, /TopModule" Val="stepper_top"/); assert.match(manifest, /TopModule" Val="stepper_tb"/);
  if (process.env.OWN_PROJECT_ZIP) copyFileSync(zipPath, process.env.OWN_PROJECT_ZIP);
  console.log('PASS download button: stepper_top.zip, 5 sources byte-exact (edited package included), manifest top stepper_top, bench stepper_tb');
  console.log('PASS own project browser journey');
} finally {
  await browser?.close();
  await server?.close();
  rmSync(temp, { recursive: true, force: true });
}
