// Controlled bridge reads only. No real tokens, provider calls or business mutations.
import assert from 'node:assert/strict';import ts from 'typescript';import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'focus-batches-')),originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
const ids=Array.from({length:1703},(_,i)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0'));let handler,missing=false,active=0,maxActive=0,calls=[];
try{
 const code=(await readFile(new URL('../supabase/inbox-functions/ai-dashboard-bridge/index.ts',import.meta.url),'utf8')).replace(/import 'jsr:[^\n]+\n/,'');
 await writeFile(join(dir,'index.mjs'),ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 globalThis.Deno={env:{get:()=> 'fixture-only'},serve:fn=>{handler=fn}};
 globalThis.fetch=async(url,options={})=>{const path=String(url),body=options.body?JSON.parse(options.body):null;calls.push({path,body});let data;
  if(path.includes('private_runtime_settings?'))data=[{setting_value:'fixture-token'}];
  else if(path.endsWith('/rpc/icetak_customer_focus_chat_ids'))data={ids,total:ids.length,truncated:false,fetched_at:'2026-10-04T00:00:00Z'};
  else if(path.endsWith('/rpc/icetak_customer_focus_chat_page')){assert(body.p_ids.length<=500);active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;data={rows:body.p_ids.slice(missing?1:0).reverse().map(id=>({id,inbound_revision:'r-'+id,messages:[]}))};}
  else throw Error('Unexpected network action: '+path);
  return Response.json(data);
 };
 await import(pathToFileURL(join(dir,'index.mjs')).href);
 const request=async(token='fixture-token')=>{const res=await handler(new Request('https://fixture.local',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify({action:'focus'})}));return {status:res.status,body:await res.json()}};
 let r=await request();assert.equal(r.status,200);assert.deepEqual(r.body.rows.map(x=>x.id),ids);assert.equal(r.body.total,1703);assert.equal(r.body.truncated,false);assert.equal(maxActive,3);assert.equal(calls.filter(x=>x.path.endsWith('/rpc/icetak_customer_focus_chat_page')).length,4);
 const before=calls.length;r=await request('wrong-token');assert.equal(r.status,401);assert.equal(calls.length-before,1);
 missing=true;r=await request();assert.equal(r.status,500);assert.match(r.body.error,/Chat berubah/);assert.equal(r.body.rows,undefined,'partial results never masquerade as full coverage');
 assert(calls.every(x=>x.path.includes('private_runtime_settings')||x.path.includes('/rpc/icetak_customer_focus_chat_')));
 console.log('PASS: frozen IDs, complete 1703-row result/order/revisions, <=500 rows per read, <=3 concurrent reads, auth denial and missing-row failure; no provider or business writes.');
}finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;await rm(dir,{recursive:true,force:true})}
