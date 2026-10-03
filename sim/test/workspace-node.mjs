// unit checks for the workspace model: paths, limits, atomic import, top/testbench by content (the CLI's rule),
// zip bytes. run: node test/workspace-node.mjs
import { pathProblem, validateImport, resolve, toRecord, encodeRecord, zip, crc32, stripRoot, layoutNotes, LIMITS, serializeRecords, restoreRecords, archiveRecords, entriesFromFileList, entriesFromDrop } from '../src/sim/project.js';
import { createWorkspaceStore } from '../src/sim/workspace.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let n = 0, bad = 0;
const ok = (c, what) => { n++; if (!c) { bad++; console.log('FAIL', what); } };
const rec = (path, text) => toRecord(path, null, text);
// paths
for (const p of ['/etc/x.sv', 'C:\\a.sv', '..\\a.sv', 'a/../b.sv', './a.sv', 'a//b.sv', 'a\0.sv', '', 'a.txt', 'a.SV2', 'ünïcode.sv', 'a;b.sv'])
  ok(pathProblem(p), `reject ${JSON.stringify(p)}`);
for (const p of ['top.sv', 'src/top.v', 'inc/defs.svh', 'x.vh', 'basys3.xdc', 'rom (1).mem', 'lab3-part_a+b.sv']) ok(!pathProblem(p), `accept ${p}`);
// limits + atomic
const big = new Uint8Array(LIMITS.fileBytes + 1);
let e = null; try { validateImport([{ path: 'a.sv', text: 'module a; endmodule' }, { path: 'b.sv', bytes: big }, { path: 'A.SV', text: '' }, { path: '../c.sv', text: '' }]); } catch (x) { e = x; }
ok(e && e.problems && e.problems.length >= 3, 'atomic: all problems listed, nothing returned ' + (e && e.problems));
e = null; try { validateImport(Array.from({ length: LIMITS.files + 1 }, (_, i) => ({ path: `m${i}.sv`, text: '' }))); } catch (x) { e = x; }
ok(e && /256/.test(e.problems.join()), 'file count limit');
const good = validateImport([{ path: 'src/top.sv', text: 'module top(input a); endmodule\r\n' }, { path: 'rom.mem', bytes: new TextEncoder().encode('00\n11\n') }]);
ok(good.length === 2 && good[0].text === 'module top(input a); endmodule\n' && good[0].eol === '\r\n', 'records normalised, eol kept');
// resolve = CLI policy (templates/check_xdc.py)
let r = resolve([rec('lab.sv', 'module counter(input clk, output [3:0] q); endmodule'), rec('t.sv', 'module counter_tb; counter u(.clk(c), .q(q)); endmodule')]);
ok(r.top === 'counter' && r.tb === 'counter_tb' && r.topFile === 'lab.sv' && r.tbFile === 't.sv' && !r.error, 'free names, top/tb by content ' + JSON.stringify(r));
r = resolve([rec('a.sv', 'module top(input c); sub s(.c(c)); endmodule\nmodule sub(input c); endmodule'), rec('tb.sv', 'module tb(); top t(.c(1)); endmodule')]);
ok(r.top === 'top' && r.tb === 'tb', 'instantiated module is not a root');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('b.sv', 'module b(input c); endmodule')]);
ok(r.error && r.error.code === 'two-tops' && r.tops.length === 2 && !r.top, 'two roots, none named -> two-tops');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('b.sv', 'module b(input c); endmodule'), rec('b.xdc', '')]);
ok(r.top === 'b' && /named by b\.xdc/.test(r.why), 'root named by xdc wins: ' + r.why);
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('b.sv', 'module b(input c); endmodule')], { top: 'b' });
ok(r.top === 'b' && !r.error, 'explicit choice');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('b.sv', 'module a(input c); endmodule')]);
ok(r.error && r.error.code === 'module-defined-twice', 'module twice');
r = resolve([rec('t.sv', 'module tb; endmodule')]);
ok(r.error && r.error.code === 'no-design-module', 'no design module');
r = resolve([rec('a.sv', 'module a #(parameter W = 4) (input [W-1:0] c); endmodule'), rec('t.sv', 'import p::*;\nmodule tb #(parameter N=1) ();\n a #(.W(2)) u(.c(0)); endmodule')]);
ok(r.top === 'a' && r.tb === 'tb', 'parameterised header and import before tb');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('x.xdc', ''), rec('y.xdc', '')]);
ok(r.xdcError && r.xdcError.code === 'two-xdc-files' && r.xdcs.length === 2 && !r.xdc, 'two xdc, none named -> choose');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('x.xdc', ''), rec('a.xdc', '')]);
ok(r.xdc === 'a.xdc', '<top>.xdc wins');
r = resolve([rec('a.sv', 'module a(input c); endmodule'), rec('x.xdc', ''), rec('y.xdc', '')], { xdc: 'y.xdc' });
ok(r.xdc === 'y.xdc' && !r.xdcError, 'explicit xdc choice');
r = resolve([rec('a.sv', '// module fake(input z);\nmodule a(input c); /* module q(input d); */ endmodule'), rec('h.svh', '`define X'), rec('rom.mem', '0')]);
ok(r.top === 'a' && r.tops.length === 1, 'modules in comments ignored, .svh/.mem not parsed');
ok(stripRoot(['lab/a.sv', 'lab/src/b.sv']).join() === 'a.sv,src/b.sv' && stripRoot(['a.sv', 'lab/b.sv']).join() === 'a.sv,lab/b.sv', 'strip common root');
ok(layoutNotes(['p.xpr', 'p.srcs/sources_1/new/a.sv']).some((s) => /xpr/.test(s)), 'vivado layout note');
// A simulation-only module is never a board root, and its role survives both storage and ZIP.
const scoped = [
  { ...rec('top.sv','module selected(input x,output y); assign y=x; endmodule'), usage:['design','simulation'] },
  { ...rec('model.sv','module model(input x,output y); assign y=x; endmodule'), usage:['simulation'] },
  { ...rec('tb.sv','module tb; selected u(1,); endmodule'), usage:['simulation'] },
];
r=resolve(scoped,{project:true,top:'selected',tb:'tb'});
ok(r.top==='selected' && r.tops.length===1 && r.tb==='tb', 'simulation-only module does not compete for top');
const flatProject=archiveRecords(scoped,{project:true,top:'selected',tb:'tb'});
ok(flatProject.some(f=>f.path==='dewfpga-workspace.xpr'), 'flat imported XPR still exports source-set manifest');
ok(restoreRecords(serializeRecords(scoped))[1].usage.join(',')==='simulation', 'source-set role survives reload');
ok(resolve(scoped,{project:true,top:'missing'}).error?.code==='no-top-module', 'missing explicit project top is not silently replaced');
ok(resolve(scoped,{project:true,top:'selected',tb:'missing'}).tbError?.code==='no-testbench', 'missing explicit simulation top is reported only for simulation');
const simDuplicate=[{...rec('sim/duplicate.sv','module selected(input z); endmodule'),usage:['simulation']},...scoped];
r=resolve(simDuplicate,{project:true,top:'selected'});
ok(!r.error && r.topFile==='top.sv' && r.tbError?.code==='module-defined-twice', 'simulation duplicate blocks testbench but not active synthesis sources');
const srcsNames = ['lab/lab.srcs/sources_1/new/top.sv','lab/lab.srcs/sim_1/new/model.sv','lab/lab.srcs/constrs_1/new/top.xdc','lab/lab.srcs/utils_1/junk.sv','lab/unrelated.sv'];
const srcsImport = await entriesFromFileList(srcsNames.map(path => ({ name:path.split('/').pop(),webkitRelativePath:path,arrayBuffer:async()=>new TextEncoder().encode('fixture').buffer })));
ok(srcsImport.entries.length===3 && !srcsImport.entries.some(e=>/junk|unrelated/.test(e.path)), '.srcs import keeps only the three project source sets');
ok(srcsImport.entries.find(e=>e.path.includes('/sim_1/')).usage.join(',')==='simulation', '.srcs simulation-only model keeps its role');
const brokenBackup=archiveRecords([rec('src/broken.sv','module unfinished('),rec('a.xdc',''),rec('b.xdc','')]);
ok(brokenBackup.length===4 && brokenBackup[0].text==='module unfinished(', 'broken project remains downloadable without changing source');
ok(brokenBackup.at(-1).text.includes('/a.xdc') && brokenBackup.at(-1).text.includes('/b.xdc'), 'unresolved constraint choice remains unresolved in exported manifest');
let collision = false; try { validateImport([{path:'a.sv',text:''},{path:'A.SV/b.sv',text:''}]); } catch { collision = true; }
ok(collision, 'file/folder path collisions are refused case-insensitively');
// zip: bytes preserved (CRLF, BOM), unzips with python + unzip -t
const crlf = new TextEncoder().encode('\ufeffmodule a(input c);\r\nendmodule\r\n');
const recs = validateImport([{ path: 'src/a.sv', bytes: crlf }, { path: 'a.xdc', text: 'set_property X\n' }, { path: 'rom.mem', bytes: new Uint8Array([0x30, 0x0a, 0xff]) }]);
ok(encodeRecord(recs[0]).join() === crlf.join(), 'untouched record exports original bytes');
const edited = { ...recs[0], raw: null, text: recs[0].text + 'x\n' };
ok(new TextDecoder('utf-8', { ignoreBOM: true }).decode(encodeRecord(edited)).startsWith('\ufeffmodule a(input c);\r\n') && new TextDecoder().decode(encodeRecord(edited)).endsWith('x\r\n'), 'edited record re-encoded with its eol+bom');
ok(crc32(new TextEncoder().encode('123456789')) === 0xcbf43926, 'crc32 check value');
const dir = mkdtempSync(join(tmpdir(), 'ws18-'));
const z = zip(recs, new Date(2026, 9, 3, 12, 0, 0)); writeFileSync(join(dir, 'w.zip'), z);
const py = execFileSync('python3', ['-c', `import zipfile,sys
z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist())); print(z.read('src/a.sv')==bytes.fromhex('${Buffer.from(crlf).toString('hex')}'), z.read('rom.mem')==b'0\\n\\xff')`, join(dir, 'w.zip')], { encoding: 'utf8' });
ok(/^None\n\['a\.xdc', 'rom\.mem', 'src\/a\.sv'\]\nTrue True/.test(py), 'python zipfile reads it back byte-exact: ' + py.trim());
let unz = ''; try { unz = execFileSync('unzip', ['-t', join(dir, 'w.zip')], { encoding: 'utf8' }); } catch (x) { unz = String(x.stdout || x); }
ok(/No errors detected/.test(unz), 'unzip -t: ' + unz.trim().split('\n').pop());
// A JSON round trip is the actual browser storage boundary; preserve raw bytes and edited EOL/BOM.
const persisted = restoreRecords(JSON.parse(JSON.stringify(serializeRecords(recs))));
for (let i = 0; i < recs.length; i++) ok(Buffer.from(encodeRecord(persisted[i])).equals(Buffer.from(encodeRecord(recs[i]))), `reload preserves bytes ${recs[i].path}`);
const editedReload = restoreRecords(JSON.parse(JSON.stringify(serializeRecords([edited]))))[0];
ok(Buffer.from(encodeRecord(editedReload)).equals(Buffer.from(encodeRecord(edited))), 'reload preserves edited CRLF and BOM');
const legacy = restoreRecords([{ path: 'old.sv', text: 'one\ntwo\n', eol: '\r\n', bom: true }])[0];
ok(Buffer.from(encodeRecord(legacy)).equals(Buffer.from('\ufeffone\r\ntwo\r\n')), 'v1 saved EOL and BOM are restored');
const mixed = rec('mixed.mem', ''); mixed.raw = new Uint8Array([0xef, 0xbb, 0xbf, 48, 13, 10, 49, 10, 50, 13, 255]);
ok(Buffer.from(encodeRecord(restoreRecords(JSON.parse(JSON.stringify(serializeRecords([mixed]))))[0])).equals(Buffer.from(mixed.raw)), 'mixed EOL and non-UTF8 bytes survive reload');
for (const malformed of [[{ path: '../a.sv', text: '' }], [{ path: 'a.sv', text: '', raw: '%%%'}]]) {
  let rejected = false; try { restoreRecords(malformed); } catch { rejected = true; }
  ok(rejected, 'malformed saved workspace is rejected');
}
// workspace store: debounce, flush, quota error surfaced, read back
const mem = new Map(); const storage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => { if (storage.full) { const q = new Error('QuotaExceededError'); q.name = 'QuotaExceededError'; throw q; } mem.set(k, v); }, removeItem: (k) => mem.delete(k) };
const states = []; let snap = { files: [{ path: 'a.sv', text: '1' }] };
const st = createWorkspaceStore({ snapshot: () => snap, onState: (s) => states.push(s), storage, debounce: 20, win: { addEventListener() {} } });
st.schedule(); ok(!mem.size, 'debounced: not written yet'); await new Promise((r) => setTimeout(r, 40)); ok(mem.size === 1 && states.at(-1).ok, 'written after debounce');
snap = { files: [{ path: 'a.sv', text: '2' }] }; st.schedule(); st.flush(); ok(st.read().files[0].text === '2', 'flush writes now, read returns v1 payload');
storage.full = true; st.schedule(); st.flush(); ok(states.at(-1).ok === false && /storage is full/.test(states.at(-1).error), 'quota error is visible: ' + states.at(-1).error);
mem.set('dewfpga.workspace', JSON.stringify({ v: 99, files: [] })); ok(st.read() === null, 'unknown version ignored');
// A loose File can have an unusable WebKit entry; mixed folder/file drops must keep both.
{
const loose = new File(['module loose(input a); endmodule'], 'loose.sv');
const missingEntry = { isFile:true, name:loose.name, file:(_ok, fail) => fail(new Error('Path does not exist')) };
const directDrop = await entriesFromDrop({ items:[{kind:'file', webkitGetAsEntry:()=>missingEntry, getAsFile:()=>loose}] });
ok(directDrop.entries.length === 1 && directDrop.entries[0].path === 'loose.sv', 'loose File survives unreadable WebKit entry');
const mem = new File(['00\r\nff\r\n'], 'rom.mem');
let batches=0;
const folder = { isDirectory:true, name:'data', createReader:()=>({ readEntries:callback=>callback(batches++ ? [] : [{isFile:true,name:'rom.mem',file:callback=>callback(mem)}]) }) };
const mixedDrop = await entriesFromDrop({ items:[{kind:'file',webkitGetAsEntry:()=>folder,getAsFile:()=>null},{kind:'file',webkitGetAsEntry:()=>null,getAsFile:()=>loose}] });
ok(mixedDrop.entries.map(e=>e.path).sort().join(',') === 'data/rom.mem,loose.sv' && Buffer.from(mixedDrop.entries[0].bytes).equals(Buffer.from('00\r\nff\r\n')), 'mixed directory and entry-less file retain every path and byte');
let unreadable=false;try { await entriesFromDrop({items:[{kind:'file',getAsFile:()=>null}]}); } catch { unreadable=true; }
ok(unreadable, 'unreadable dropped item fails instead of silently dropping a file');
const traversal = await entriesFromDrop({items:[{kind:'file',getAsFile:()=>new File(['x'],'../evil.sv')}]});
let unsafe=false;try { validateImport(traversal.entries); } catch { unsafe=true; }
ok(unsafe, 'direct File fallback still rejects traversal atomically');
}
console.log(`workspace-node: ${n - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
