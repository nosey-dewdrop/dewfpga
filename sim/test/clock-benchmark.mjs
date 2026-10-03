// Compare the current browser engine with a CXXRTL/WASM kernel built by local tools.
// CXXRTL build time is reported separately: this is not a browser-side C++ compiler integration.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const tmp=mkdtempSync(join(tmpdir(),'dewfpga-clock-'));
const OUT=process.env.OUT;
const source=(half)=>`module top(input clk,input rst,output reg led=0); reg [25:0] counter=0; always @(posedge clk) if(rst) begin counter<=0;led<=0;end else if(counter==${half}-1) begin counter<=0;led<=~led;end else counter<=counter+1'b1; endmodule\n`;
const exec=(args)=>{const p=spawnSync(args[0],args.slice(1),{cwd:tmp,encoding:'utf8',timeout:180000,env:{...process.env,LC_ALL:'C',LC_CTYPE:'C',LANG:'C'}});assert.equal(p.status,0,`${args[0]}: ${p.error||''}\n${p.stderr}\n${p.stdout}`);return p.stdout.trim();};
const datdir=exec(['yosys-config','--datdir']);
const versions={yosys:exec(['yosys','-V']),emcc:exec(['emcc','--version']).split('\n')[0]};
const builds=[];
for(const half of [50000000,64]) {
  const dir=join(tmp,String(half));mkdirSync(dir);
  writeFileSync(join(dir,'design.sv'),source(half));
  const t=performance.now();
  exec(['yosys','-Q','-q','-p',`read_verilog -sv ${dir}/design.sv; hierarchy -check -top top; write_cxxrtl -O6 ${dir}/model.cc`]);
  writeFileSync(join(dir,'driver.cc'),`#include "model.cc"\n#include <memory>\nstatic std::unique_ptr<cxxrtl_design::p_top> model;\nextern "C" void reset(){model=std::make_unique<cxxrtl_design::p_top>();model->p_rst.set<unsigned>(0);model->p_clk.set<unsigned>(0);model->step();}\nextern "C" unsigned run(unsigned n){for(unsigned i=0;i<n;i++){model->p_clk.set<unsigned>(1);model->step();model->p_clk.set<unsigned>(0);model->step();}return model->p_led.get<unsigned>();}\n`);
  exec(['emcc',join(dir,'driver.cc'),'-std=c++17','-O3','-I'+join(datdir,'include/backends/cxxrtl/runtime'),'-sMODULARIZE=1','-sEXPORT_ES6=1','-sENVIRONMENT=web','-sEXPORTED_FUNCTIONS=["_reset","_run"]','-sALLOW_MEMORY_GROWTH=1','-o',join(dir,'model.mjs')]);
  builds.push({half,build_ms:Math.round(performance.now()-t),wasm_bytes:statSync(join(dir,'model.wasm')).size});
}
await build({root,logLevel:'error'});
const server=await preview({root,preview:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
try {
  browser=await chromium.launch({headless:true});const page=await browser.newPage();page.on('dialog',d=>d.accept());
  await page.route('**/bench/**',async route=>{
    const path=new URL(route.request().url()).pathname.split('/bench/')[1];
    assert.match(path,/^(50000000|64)\/model\.(mjs|wasm)$/);
    await route.fulfill({contentType:path.endsWith('.wasm')?'application/wasm':'text/javascript',body:readFileSync(join(tmp,path))});
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
  await page.waitForFunction(()=>window.dewfpga?.sim,{timeout:120000});
  const xdc='set_property PACKAGE_PIN W5 [get_ports clk]\nset_property IOSTANDARD LVCMOS33 [get_ports clk]\nset_property PACKAGE_PIN U18 [get_ports rst]\nset_property IOSTANDARD LVCMOS33 [get_ports rst]\nset_property PACKAGE_PIN U16 [get_ports led]\nset_property IOSTANDARD LVCMOS33 [get_ports led]\n';
  const results=[];
  for(const item of builds) {
    await page.evaluate(({sv,xdc})=>window.dewfpga.importRecords([{path:'top.sv',text:sv},{path:'top.xdc',text:xdc}],'clock measurement'),{sv:source(item.half),xdc});
    await page.waitForFunction(()=>window.dewfpga.sim?.top==='top' && window.dewfpga.pendingRequests===0,{timeout:120000});
    assert.equal(await page.locator('#timing-help').isVisible(),item.half===50000000,'large threshold hint uses compiled SIM netlist, not inactive source branches');
    if(item.half===50000000) assert.match(await page.locator('#timing-estimate').textContent(),/50,000,000/);
    await page.click('#pause');
    const measured=await page.evaluate(async({half})=>{
      const sim=window.dewfpga.sim;
      const create=(await import(`/bench/${half}/model.mjs`)).default;const wasm=await create();
      const resetJs=()=>{sim.setBit('rst',0,1);sim.cycle('clk');sim.setBit('rst',0,0);sim.settle();};
      const samples=(run,reset,chunk)=>{const rates=[];for(let r=0;r<3;r++){reset();let n=0;const start=performance.now();while(performance.now()-start<500){run(chunk);n+=chunk;}rates.push(n*1000/(performance.now()-start));}return rates;};
      const js=samples(n=>{for(let i=0;i<n;i++)sim.cycle('clk');},resetJs,100);
      const fast=samples(n=>wasm._run(n),()=>wasm._reset(),100000);
      resetJs();wasm._reset();const equivalence=[];
      for(const n of [1,62,1,1,63,128,513]) { for(let i=0;i<n;i++)sim.cycle('clk');const a=sim.outBit('led',0)===1?1:0,b=wasm._run(n);equivalence.push({cycles:n,current:a,cxxrtl:b}); }
      wasm._reset();const begin=performance.now();const first=wasm._run(half),firstMs=performance.now()-begin;
      return {current_cycles_per_second:js,cxxrtl_cycles_per_second:fast,equivalence,cxxrtl_first_toggle:{cycles:half,led:first,ms:firstMs}};
    },{half:item.half});
    for(const row of measured.equivalence) assert.equal(row.current,row.cxxrtl,JSON.stringify(row));
    assert.equal(measured.cxxrtl_first_toggle.led,1);
    if(item.half===50000000) {
      await page.click('#pause');
      measured.frame_rates = await page.evaluate(async()=>{
        const out={finite:[],max:[]}, sleep=ms=>new Promise(r=>setTimeout(r,ms));
        for(let round=0;round<3;round++) for(const [name,value] of [['finite','4'],['max','5']]) {
          const control=document.querySelector('#speed');control.value=value;control.dispatchEvent(new Event('input'));
          await sleep(200);const before=window.dewfpga.sim.cycles,start=performance.now();await sleep(1000);
          out[name].push((window.dewfpga.sim.cycles-before)*1000/(performance.now()-start));
        }
        return out;
      });
      const median=a=>[...a].sort((a,b)=>a-b)[1];
      assert.ok(median(measured.frame_rates.max)>=median(measured.frame_rates.finite)*0.85,'Max must not be systematically slower than 10,000 cycles/frame');
      await page.click('#pause');
    }
    results.push({...item,...measured});console.log(JSON.stringify(results.at(-1)));
  }
  const report={versions,browser:browser.version(),scope:'One initialized 26-bit threshold counter; kernel throughput, not complete application FPS; CXXRTL compiled by native local tools; no browser compiler integration',results};
  if(OUT)writeFileSync(OUT,JSON.stringify(report,null,2)+'\n');
} finally {if(browser)await browser.close();await server.close();rmSync(tmp,{recursive:true,force:true});}
