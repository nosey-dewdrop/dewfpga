// Audit compilation decisions across the native corpus. This is not behavioral equivalence,
// place-and-route, or proof that DigitalJS can instantiate every returned cell.
import { build, preview } from 'vite';
import { chromium } from 'playwright';
import { readFileSync,readdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { resolve,validateImport,kindOf,parseModules } from '../src/sim/project.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const corpus=join(root,'../test/sv');
const expected=readFileSync(join(corpus,'expect.tsv'),'utf8').trim().split('\n').slice(1).map(l=>l.split('\t'));
const native=new Map(process.env.NATIVE_RESULTS ? readFileSync(process.env.NATIVE_RESULTS,'utf8').trim().split('\n').map(l=>{const a=l.split('\t');return[a[0],a[3]];}) : []);
await build({root,logLevel:'error'});
const server=await preview({root,preview:{host:'127.0.0.1',port:0},logLevel:'error'});let browser;
const results=[];
try {
 browser=await chromium.launch({headless:true});const page=await browser.newPage();
 await page.route('**/harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>compile decision audit</title>'}));
 const base=`http://127.0.0.1:${server.httpServer.address().port}`;
 await page.goto(base+'/harness');
 const asset=readdirSync(join(root,'dist/assets')).find(n=>/^yosys\.worker-.*\.js$/.test(n));
 await page.evaluate(url=>{
  let worker=new Worker(url,{type:'module'}),id=0;
  window.compile=(files,extra,top)=>new Promise(resolve=>{
   const request=++id;
   const timer=setTimeout(()=>{worker.terminate();worker=new Worker(url,{type:'module'});resolve({ok:false,infrastructure_error:'90-second worker timeout'});},90000);
   const done=e=>{if(e.data.id!==request)return;clearTimeout(timer);worker.removeEventListener('message',done);const {ok,diags,ms,reader}=e.data;resolve({ok,diags,ms,reader});};
   worker.addEventListener('message',done);worker.postMessage({id:request,kind:'compile',files,extra,top});
  });
 },base+'/assets/'+asset);
 for(const row of expected) {
  const id=row[0],files={},extra={};
  const entries=readdirSync(join(corpus,id)).filter(n=>kindOf(n)&&n!=='tb.sv').sort().map(path=>({path,text:readFileSync(join(corpus,id,path),'utf8')}));
  const records=validateImport(entries),role=resolve(records),parsed=parseModules(records);
  for(const file of records){if(kindOf(file.path)==='source'){const mods=[...parsed.mods.values()].filter(m=>m.file===file.path);if(!mods.length||!mods.every(m=>m.tb))files[file.path]=file.text;}else if(['header','mem'].includes(kindOf(file.path)))extra[file.path]=file.text;}
  const result=role.error ? {ok:false,diags:[{kind:'error',text:role.error.text}],preflight:role.error.code} : await page.evaluate(({files,extra,top})=>window.compile(files,extra,top),{files,extra,top:role.top});
  const nativeSynthesis=native.get(id)||row[5],same=(result.ok?'pass':'fail')===nativeSynthesis;
  const item={id,native_synthesis:nativeSynthesis,browser_compile:result.ok?'pass':'fail',same,...result};results.push(item);
  console.log(`${same?'MATCH':'DIFFER'} ${id}: native ${nativeSynthesis}, browser ${item.browser_compile}${result.infrastructure_error?' '+result.infrastructure_error:''}`);
  if(process.env.OUT)writeFileSync(process.env.OUT,JSON.stringify({scope:'compile decisions only; native synthesis status does not imply correct netlist or timing closure',complete:false,results},null,2)+'\n');
 }
 const summary={probes:results.length,matches:results.filter(x=>x.same).length,native_accept_browser_reject:results.filter(x=>!x.same&&x.native_synthesis==='pass').map(x=>x.id),native_reject_browser_accept:results.filter(x=>!x.same&&x.native_synthesis==='fail').map(x=>x.id),infrastructure_errors:results.filter(x=>x.infrastructure_error).map(x=>x.id)};
 if(process.env.OUT)writeFileSync(process.env.OUT,JSON.stringify({scope:'compile decisions only; no behavioral equivalence or timing claim',complete:true,summary,results},null,2)+'\n');
 console.log(JSON.stringify(summary));
}finally{if(browser)await browser.close();await server.close();}
