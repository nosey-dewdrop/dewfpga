// Browser import and the native reader must choose the same active XPR files.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(),'dewfpga-xpr-browser-'));
const project = join(temp,'lab'); mkdirSync(project);
const xml = `<Project><Configuration><Option Name="ActiveSimSet" Val="test_active"/></Configuration><FileSets>
<FileSet Name="sources_unused" Type="DesignSrcs"><File Path="$PPRDIR/unused.sv"/></FileSet>
<FileSet Name="sources_active" Type="DesignSrcs">
<File Path="$PSRCDIR/sources_1/new/design.sv"/>
<File Path="$PPRDIR/disabled.sv"><FileInfo><Attr Name="IsEnabled" Val="false"/></FileInfo></File>
<Config><Option Name="TopModule" Val="selected"/></Config></FileSet>
<FileSet Name="pins" Type="Constrs"><File Path="$PPRDIR/pins.xdc"/></FileSet>
<FileSet Name="test_unused" Type="SimulationSrcs"><File Path="$PPRDIR/unused_tb.sv"/></FileSet>
<FileSet Name="test_active" Type="SimulationSrcs"><File Path="$PPRDIR/sim/bench.sv"/><File Path="$PPRDIR/sim/model.sv"/><Config><Option Name="TopModule" Val="chosen_tb"/></Config></FileSet>
</FileSets><Runs><Run Id="synth_1" SrcSet="sources_active" ConstrsSet="pins"/></Runs></Project>`;
const files = {
  'lab.xpr':xml,
  'lab.srcs/sources_1/new/design.sv':'\ufeffmodule selected(input [15:0] sw, output [15:0] led); assign led = ~sw; endmodule\r\n',
  'sim/bench.sv':'module chosen_tb; reg [15:0] sw=0; wire [15:0] led; selected dut(sw,led); initial begin #1; if(led!==16\'hffff) $fatal(1,"wrong selected design"); $display("PASS active XPR"); $finish; end endmodule\n',
  'sim/model.sv':'module simulation_model(input x,output y); assign y=x; endmodule\n',
  'pins.xdc':readFileSync(new URL('../../templates/blink.xdc',import.meta.url),'utf8'),
  'disabled.sv':'module selected THIS DISABLED FILE MUST NOT COMPILE\n',
  'unused.sv':'module selected THIS INACTIVE SET MUST NOT COMPILE\n',
  'unused_tb.sv':'module wrong_tb THIS INACTIVE SET MUST NOT COMPILE\n',
};
for (const [name,text] of Object.entries(files)) { mkdirSync(join(project,name,'..'),{ recursive:true }); writeFileSync(join(project,name),text); }
const native=spawnSync('python3',['-B',join(root,'../templates/check_xdc.py'),'--xpr','lab.xpr'],{ cwd:project,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'} });
assert.equal(native.status,0,native.stderr);
assert.match(native.stdout,/^TOP=selected$/m); assert.match(native.stdout,/^SIMTOP=chosen_tb$/m); assert.doesNotMatch(native.stdout,/disabled|unused/);
await build({ root, logLevel:'error' });
const server=await preview({ root,preview:{ host:'127.0.0.1',port:0 },logLevel:'error' }); let browser;
try {
  browser=await chromium.launch({ headless:true }); const page=await browser.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message)); page.on('dialog',d=>d.accept());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(()=>window.dewfpga?.sim,{ timeout:120000 });
  await page.setInputFiles('#folder-input',project);
  await page.waitForFunction(()=>window.dewfpga?.sim?.top==='selected',{ timeout:120000 });
  const state=await page.evaluate(()=>({ roles:window.dewfpga.roles, records:window.dewfpga.files.all().map(f=>({path:f.path,usage:f.usage})) }));
  assert.equal(state.roles.top,'selected'); assert.equal(state.roles.tb,'chosen_tb');
  assert.deepEqual(state.records.map(f=>f.path).sort(),['lab.srcs/sources_1/new/design.sv','pins.xdc','sim/bench.sv','sim/model.sv']);
  assert.deepEqual(state.records.find(f=>f.path==='sim/model.sv').usage,['simulation']);
  assert.equal(state.roles.tops.length,1,'simulation-only model cannot become design top');
  assert.equal(await page.locator('.filetree-file').count(),4);
  await page.locator('.filetree-file[data-path="sim/model.sv"]').click();
  assert.equal(await page.evaluate(()=>window.dewfpga.files.active),'sim/model.sv');
  await page.locator('.filetree-folder[data-folder="sim/"] > summary').click();
  assert.equal(await page.locator('.filetree-folder[data-folder="sim/"]').evaluate(e=>e.open),false);
  await page.locator('.filetree-folder[data-folder="sim/"] > summary').click();
  await page.locator('.filetree-file[data-path="lab.srcs/sources_1/new/design.sv"]').click();
  const duplicateRefused=await page.evaluate(()=>{ try { window.dewfpga.files.add('SIM/model.sv','module nope; endmodule');return false; } catch { return true; } });
  assert.equal(duplicateRefused,true,'case-only duplicate add is refused before changing editors');
  for (const width of [320,1366]) {
    await page.setViewportSize({width,height:900});
    const geometry=await page.evaluate(()=>({ overflow:document.documentElement.scrollWidth>innerWidth,small:[...document.querySelectorAll('.filetree-file')].filter(e=>e.getBoundingClientRect().height>0 && e.getBoundingClientRect().height<40).length }));
    assert.deepEqual(geometry,{overflow:false,small:0});
    if(process.env.E2E_OUT) { mkdirSync(process.env.E2E_OUT,{recursive:true}); await page.screenshot({path:join(process.env.E2E_OUT,`workspace-tree-${width}.png`),fullPage:true}); }
  }
  await page.click('#view-tb');
  await page.waitForFunction(()=>document.querySelector('#out').textContent.includes('PASS active XPR'),{ timeout:120000 });
  await page.evaluate(()=>window.dewfpga.store.flush()); await page.reload();
  await page.waitForFunction(()=>document.querySelector('#out').textContent.includes('PASS active XPR'),{ timeout:120000 });
  assert.deepEqual(await page.evaluate(()=>window.dewfpga.files.all().find(f=>f.path==='sim/model.sv').usage),['simulation']);
  // A share link must carry the selected project roles and original bytes into a fresh browser profile.
  await page.evaluate(()=>{
    window.dewfpga.files.add('spare.sv','module another_root(input a, output y); assign y=a; endmodule');
    window.dewfpga.files.add('alternate.xdc','# deliberately not the selected constraints');
  });
  assert.equal(await page.evaluate(()=>window.dewfpga.roles.tops.length),2,'two design roots require the preserved choice');
  assert.equal(await page.evaluate(()=>window.dewfpga.roles.xdcs.length),2,'two constraint files require the preserved choice');
  await page.click('#share');
  const link=page.url(), freshContext=await browser.newContext(), fresh=await freshContext.newPage();
  fresh.on('pageerror',e=>errors.push(e.message));
  await fresh.goto(link); await fresh.waitForFunction(()=>window.dewfpga?.roles,{timeout:120000});
  assert.equal(await fresh.evaluate(()=>window.dewfpga.roles.top),'selected','shared simulation model must not become a second design root');
  assert.equal(await fresh.evaluate(()=>window.dewfpga.roles.tb),'chosen_tb');
  assert.equal(await fresh.evaluate(()=>window.dewfpga.roles.xdc),'pins.xdc');
  const snapshot=p=>p.evaluate(()=>window.dewfpga.files.all().map(f=>({path:f.path,usage:f.usage,eol:f.eol,bom:f.bom,bytes:Array.from(f.raw || new TextEncoder().encode((f.bom?'\ufeff':'')+f.text.replace(/\n/g,f.eol || '\n')))})));
  assert.deepEqual(await snapshot(fresh),await snapshot(page),'share preserves roles, BOM and exact unedited bytes');
  await fresh.waitForFunction(()=>document.querySelector('#out').textContent.includes('PASS active XPR'),{timeout:120000});
  await freshContext.close();
  const before=await page.evaluate(()=>window.dewfpga.files.order.join(','));
  writeFileSync(join(project,'lab.xpr'),xml.replace('$PSRCDIR/sources_1/new/design.sv','$PPRDIR/missing.sv'));
  await page.setInputFiles('#folder-input',project);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('referenced file is missing'));
  assert.equal(await page.evaluate(()=>window.dewfpga.files.order.join(',')),before,'invalid import must not replace workspace');
  writeFileSync(join(project,'lab.xpr'),xml.replace('$PSRCDIR/sources_1/new/design.sv','$PPRDIR/../../outside.sv'));
  await page.setInputFiles('#folder-input',project);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('escapes the opened folder'));
  assert.equal(await page.evaluate(()=>window.dewfpga.files.order.join(',')),before);
  assert.deepEqual(errors,[]);
  console.log('PASS active XPR: native/browser selections match; disabled/inactive sources excluded; simulation model not a design top; folder tree opens files and folds folders; testbench passes before and after reload; fresh-profile share preserves explicit top/XDC choices, simulation roles and BOM/CRLF bytes; missing/escaping references refuse atomically');
} finally { if(browser) await browser.close();await server.close();rmSync(temp,{recursive:true,force:true}); }
