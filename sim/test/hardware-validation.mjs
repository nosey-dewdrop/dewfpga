// Exercise the actual built WASM worker, including the hardware pass after the SIM build.
import { build, preview } from 'vite';
import { chromium, webkit, firefox } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
let server;
if (!process.env.BASE) {
  await build({ root, logLevel:'error' });
  server = await preview({ root, preview:{ host:'127.0.0.1', port:0 }, logLevel:'error' });
}
let browser;
try {
  const base = (process.env.BASE || `http://127.0.0.1:${server.httpServer.address().port}`).replace(/\/$/, '');
  const asset = readdirSync(join(root,'dist/assets')).find(n => /^yosys\.worker-.*\.js$/.test(n));
  assert.ok(asset, 'built Yosys worker');
  const browserName = process.env.BROWSER || 'chromium';
  const type = { chromium, webkit, firefox }[browserName];
  assert.ok(type, `supported BROWSER=${browserName}`);
  const launch = { headless:true };
  if (process.env.E2E_EXECUTABLE) launch.executablePath = process.env.E2E_EXECUTABLE;
  browser = await type.launch(launch);
  console.log(`worker validation browser ${browserName} ${browser.version()}`);
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e => errors.push(e.message));
  await page.route('**/harness', route => route.fulfill({ contentType:'text/html',body:'<!doctype html><title>worker validation</title>' }));
  await page.goto(base+'/harness');
  await page.evaluate((url) => {
    const worker = new Worker(url,{ type:'module' }); let id=0;
    window.compile = (files, extra = {}) => new Promise((resolve,reject) => {
      const request = ++id;
      const timer=setTimeout(() => reject(new Error('worker exceeded 120 seconds')),120000);
      const done=(event) => { if(event.data.id === request) { clearTimeout(timer);worker.removeEventListener('message',done);resolve(event.data); } };
      worker.addEventListener('message',done);worker.postMessage({ id:request,kind:'compile',files,extra,top:'top' });
    });
  },base+'/assets/'+asset);
  const cases=[
    ['01_latch_comb',true,'latch'],
    ['03_async_reset_nonconst',false,'async-reset-nonconst'],
    ['03b_async_reset_selfref',false,'async-reset-nonconst'],
    ['09_always_procs',true,null],
    ['16b_func_return',true,'read-with-slang'],
  ].map(([name,ok,code]) => ({ name,ok,code,source:readFileSync(new URL(`../../test/sv/${name}/design.sv`,import.meta.url),'utf8') }));
  cases.push({ name:'constant asynchronous reset',ok:true,source:'module top(input clk, input rst, input d, output reg q); always @(posedge clk or posedge rst) if(rst) q <= 0; else q <= d; endmodule' });
  cases.push({ name:'unsafe hardware hidden from SIM',ok:false,code:'async-reset-nonconst',source:'module top(input clk, input rst, input d, output reg q);\n`ifdef SIM\nalways @(posedge clk) q <= d;\n`else\nalways @(posedge clk or posedge rst) if(rst) q <= d; else q <= ~q;\n`endif\nendmodule' });
  cases.push({name:'high counter bit timing hint',ok:true,timingCycles:67108864,source:'module top(input clk, output led); reg [26:0] count=0; always @(posedge clk) count<=count+1; assign led=count[26]; endmodule'});
  cases.push({name:'>= reload threshold timing hint',ok:true,timingThreshold:50000000,source:'module top(input clk, output reg led=0); reg [25:0] c=0; always @(posedge clk) if(c>=26\'d49999999) begin c<=0; led<=~led; end else c<=c+1; endmodule'});
  cases.push({name:'unused increment is not a counter',ok:true,noTiming:true,source:'module top(input clk,input [26:0] d,output led); reg [26:0] count=0; wire [26:0] unused=count+1; always @(posedge clk) count<=d; assign led=count[26]; endmodule'});
  cases.push({ name:'Slang source and include paths with spaces',ok:true,code:'read-with-slang',path:'rtl folder/-top [1].sv',extra:{ 'rtl folder/constants.svh':'`define VALUE 7' },source:'`include "constants.svh"\nmodule top(output [3:0] led); function automatic [3:0] value(); return `VALUE; endfunction assign led=value(); endmodule' });
  for(const item of cases) {
    const result=await page.evaluate(({source,path,extra}) => window.compile({ [path || 'design.sv']:source },extra),item);
    assert.equal(result.ok,item.ok,`${item.name}: ${JSON.stringify(result.diags)}`);
    if(item.noTiming) assert.deepEqual(result.timingHints,[],item.name);
    if(item.timingCycles) assert.ok(result.timingHints.some(h=>h.kind==='bit' && h.cycles===item.timingCycles),JSON.stringify(result.timingHints));
    if(item.timingThreshold) assert.ok(result.timingHints.some(h=>h.kind!=='bit' && h.cycles===item.timingThreshold),JSON.stringify(result.timingHints));
    if(item.code) assert.ok(result.diags.some(d => d.text.includes(`[${item.code}]`)),`${item.name}: coded diagnostic`);
    if(item.code==='async-reset-nonconst') assert.ok(result.diags.some(d => d.kind==='error' && d.file==='design.sv' && d.line>0),`${item.name}: source location`);
    console.log(`PASS ${item.name}: ${result.ok ? 'accepted' : 'rejected'}${item.code ? ' ['+item.code+']' : ''}`);
  }
  const tbAsset = readdirSync(join(root,'dist/assets')).find(n => /^tb\.worker-.*\.js$/.test(n));
  assert.ok(tbAsset, 'built Icarus worker');
  await page.evaluate((url) => {
    const worker = new Worker(url, { type:'module' }); let id=0;
    window.testbench = (files) => new Promise((resolve,reject) => {
      const request=++id; const timer=setTimeout(() => reject(new Error('Icarus exceeded 30 seconds')),30000);
      const done=(e) => { if(e.data.id===request) { clearTimeout(timer);worker.removeEventListener('message',done);resolve(e.data); } };
      worker.addEventListener('message',done); worker.postMessage({ id:request, files, top:'tb' });
    });
  },base+'/assets/'+tbAsset);
  const tbCases = [
    { name:'Verilog-2005 keyword as identifier', ok:true, files:{ 'tb.v':'module tb; reg bit; initial begin bit=1; $display("PASS bit=%0d",bit); $finish; end endmodule' } },
    { name:'SystemVerilog inside .v is refused', ok:false, stage:'compile', files:{ 'tb.v':'module tb; logic q; initial begin q=1; $finish; end endmodule' } },
    { name:'$stop terminates without interactive prompt', ok:true, files:{ 'tb.sv':'module tb; initial begin $display("PASS before stop"); $stop; end endmodule' } },
    { name:'$error does not become success at $finish', ok:false, code:'testbench-error', files:{ 'tb.sv':'module tb; initial begin $error("intentional failing assertion"); $finish; end endmodule' } },
    { name:'$fatal reports process failure', ok:false, code:'sim-exit', files:{ 'tb.sv':'module tb; initial $fatal(1,"intentional fatal"); endmodule' } },
    { name:'package is compiled before its consumer', ok:true, files:{ 'a.sv':'module tb; import p::*; initial begin if(N!=7) $fatal(1,"wrong package"); $finish; end endmodule', 'z.sv':'package p; parameter N=7; endpackage' } },
  ];
  for(const item of tbCases) {
    const result=await page.evaluate(files => window.testbench(files),item.files);
    assert.equal(result.ok,item.ok,`${item.name}: ${JSON.stringify(result)}`);
    if(item.stage) assert.equal(result.stage,item.stage,item.name);
    if(item.code) assert.equal(result.code,item.code,item.name);
    console.log(`PASS ${item.name}`);
  }
  assert.deepEqual(errors,[]);
  console.log(`hardware-validation: ${cases.length + tbCases.length} passed, 0 failed; no page errors`);
} finally { if(browser) await browser.close(); if (server) await server.close(); }
