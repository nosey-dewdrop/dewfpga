// Check the actual browser worker's netlist under the probe testbench, then drive DigitalJS itself.
// This covers three regression cases; it is not whole-corpus behavioral equivalence.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)), tmp=mkdtempSync(join(tmpdir(),'dewfpga-worker-behavior-'));
const exec=(args)=>{const r=spawnSync(args[0],args.slice(1),{cwd:tmp,encoding:'utf8',timeout:30000,env:{...process.env,LC_ALL:'C',LC_CTYPE:'C',LANG:'C'}});assert.equal(r.status,0,`${args[0]}: ${r.error||''}\n${r.stdout}\n${r.stderr}`);return r.stdout;};
await build({root,logLevel:'error'});
const server=await preview({root,preview:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage(),errors=[];
 page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 await page.goto(base+'/');await page.waitForFunction(()=>window.dewfpga?.sim,null,{timeout:120000});
 const asset=readdirSync(join(root,'dist/assets')).find(n=>/^yosys\.worker-.*\.js$/.test(n));
 await page.evaluate(url=>{const worker=new Worker(url,{type:'module'});let id=0;window.probeCompile=files=>new Promise((resolve,reject)=>{const request=++id;const timer=setTimeout(()=>reject(Error('worker timeout')),120000);const done=e=>{if(e.data.id!==request)return;clearTimeout(timer);worker.removeEventListener('message',done);resolve(e.data);};worker.addEventListener('message',done);worker.postMessage({id:request,kind:'compile',files,top:'top'});});},base+'/assets/'+asset);
 const xdc=readFileSync(join(root,'../templates/blink.xdc'),'utf8')+'\nset_property PACKAGE_PIN U18 [get_ports btnC]\nset_property IOSTANDARD LVCMOS33 [get_ports btnC]\n';
 for(const probe of ['22b_interface_own_file','23c_package_own_file','58_hier_name']) {
  const dir=join(root,'../test/sv',probe),files={};
  for(const name of readdirSync(dir).filter(n=>/\.(sv|v)$/.test(n)&&n!=='tb.sv'))files[name]=readFileSync(join(dir,name),'utf8');
  const result=await page.evaluate(files=>window.probeCompile(files),files);assert.equal(result.ok,true,`${probe}: ${JSON.stringify(result.diags)}`);
  if(probe==='58_hier_name')assert.equal(result.reader,'slang','hierarchical reference must trigger second reader');
  writeFileSync(join(tmp,'net.json'),result.json);writeFileSync(join(tmp,'tb.sv'),readFileSync(join(dir,'tb.sv')));
  exec(['yosys','-Q','-q','-p','read_json net.json; hierarchy -top top; flatten; write_verilog -noattr net.v']);
  exec(['iverilog','-g2012','-s','tb','-o','run.vvp','net.v','tb.sv']);
  const output=exec(['vvp','-n','run.vvp']);
  if(process.env.OUT){const dir=join(process.env.OUT,probe);mkdirSync(dir,{recursive:true});for(const n of ['net.json','net.v','tb.sv'])copyFileSync(join(tmp,n),join(dir,n));writeFileSync(join(dir,'vvp.log'),output);}
  const nativeOk=/\bPASS\b/.test(output)&&!/\bFAIL\b/.test(output);
  console.log(`${nativeOk ? 'PASS':'FAIL'} ${probe}: actual worker netlist under original testbench`);
  await page.evaluate(({files,xdc})=>window.dewfpga.importRecords([...Object.entries(files).map(([path,text])=>({path,text})),{path:'pins.xdc',text:xdc}],'behavior probe'),{files,xdc});
  await page.waitForFunction(()=>window.dewfpga.pendingRequests===0&&(window.dewfpga.sim?.top==='top'||document.querySelector('#status').textContent.includes('not running')),null,{timeout:120000});
  assert.equal(await page.evaluate(()=>window.dewfpga.sim?.top),'top',await page.locator('#console').innerText());
  if(probe==='58_hier_name')await page.click('#pause');
  const checks=await page.evaluate(probe=>{
   const sim=window.dewfpga.sim;const drive=value=>{for(let bit=0;bit<16;bit++)sim.setBit('sw',bit,(value>>bit)&1);sim.settle();};
   const read=()=>{let n=0;for(let bit=0;bit<16;bit++){const b=sim.outBit('led',bit);if(b!==-1&&b!==1)throw Error(`unknown led[${bit}]`);if(b===1)n+=2**bit;}return n;};
   let state=0;
   if(probe==='58_hier_name'){sim.setBit('btnC',0,1);sim.settle();sim.setBit('btnC',0,0);sim.settle();}
   const count=probe==='58_hier_name'?64:256;
   for(let i=0;i<count;i++){
    const go=((i>>1)^(i>>3))&1;drive(probe==='58_hier_name'?go:(probe.startsWith('22b')?0x3c00:0xc300)|i);
    const expected=probe==='58_hier_name'?(state|(state===1?0x8000:0)):probe.startsWith('22b')?(i&15)+((i>>4)&15):((i&0x70)<<1)|((i^10)&15);
    const actual=read();if(actual!==expected)throw Error(`${probe} step${i}: actual ${actual}, expected ${expected}`);
    if(probe==='58_hier_name'){sim.cycle('clk');state=state===0?(go?1:0):state===1?2:0;}
   }return count;
  },probe);
  console.log(`PASS ${probe}: DigitalJS actual engine ${checks} output comparisons`);
  assert.equal(nativeOk,true,output);
 }
 assert.deepEqual(errors,[]);console.log('behavior: 3 worker netlists and 576 DigitalJS vectors passed; no page errors');
}finally{if(browser)await browser.close();await server.close();rmSync(tmp,{recursive:true,force:true});}
