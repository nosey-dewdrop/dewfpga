// The downloaded nested project must build through the real CLI, with its explicit choices.
import { nestedProject } from './fixtures/nested-project.mjs';
import { archiveRecords, validateImport, zip } from '../src/sim/project.js';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = process.env.DEWFPGA_TEST_CLI || join(root, 'bin/dewfpga');
const temp = mkdtempSync(join(tmpdir(), 'dewfpga-nested-zip-'));
const records = validateImport(nestedProject);
const chosen = { top: 'chosen', xdc: 'constraints/pins.xdc' };
const run = (args, cwd=temp) => {
  const p = spawnSync(args[0], args.slice(1), { cwd, env: { ...process.env, LC_ALL: 'C', LC_CTYPE: 'C', LANG: 'C', PYTHONDONTWRITEBYTECODE: '1' }, encoding:'utf8', timeout:120000 });
  assert.equal(p.status, 0, `${args.join(' ')}\n${p.error || ''}\n${p.stdout}\n${p.stderr}`);
  return p.stdout + p.stderr;
};
try {
  const archived = archiveRecords(records, chosen);
  assert.equal(archived.length, records.length + 1);
  writeFileSync(join(temp, 'project.zip'), zip(archived));
  run(['python3','-B','-c','import zipfile; zipfile.ZipFile("project.zip").extractall("project")']);
  const project = join(temp, 'project');
  for (const r of records) assert.deepEqual(readFileSync(join(project,r.path)), Buffer.from(r.raw || r.text.replace(/\n/g,r.eol)));
  const info = run(['python3','-B',join(root,'templates/check_xdc.py'),'--xpr','dewfpga-workspace.xpr'], project);
  assert.match(info, /^TOP=chosen$/m); assert.match(info, /^SIMTOP=bench$/m);
  assert.match(info, /^XDC=constraints\/pins.xdc$/m); assert.doesNotMatch(info, /unselected/);
  const sim = run([cli,'sim'], project); assert.match(sim, /PASS nested ROM all 16 addresses/);
  const bit = run([cli,'bit'], project); assert.match(bit, /pnr ok/);
  assert.ok(existsSync(join(project,'chosen.bit')));
  console.log('PASS nested ZIP: 7 files byte-exact; selected top/XDC; header and ROM; real CLI sim checks all 16 addresses; bitstream built');
} finally { rmSync(temp, { recursive:true, force:true }); }
