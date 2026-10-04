// Execute the real handler with isolated database/auth fixtures; no production writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const work=fs.mkdtempSync(join(tmpdir(),'phone-ingest-check-'));const modulePath=join(work,'ingest.mjs');
const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;let handler,mode='merge',calls=[];
const fixtureToken='fixture-only',digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fixtureToken))).toString('hex');
let source=fs.readFileSync(new URL('../supabase/functions/crm-identity-ingest/index.ts',import.meta.url),'utf8').replace(/import "jsr:[^\n]+\n/,'').replace(/const TOKEN_HASH = "[a-f0-9]+"/,`const TOKEN_HASH = "${digest}"`);
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://fixture.local':'fixture-service'},serve:fn=>handler=fn};
globalThis.fetch=async(url,opt={})=>{const path=String(url);const body=opt.body?JSON.parse(opt.body):undefined;calls.push({path,method:opt.method,body});let data;
 if(path.includes('/rpc/icetak_reconcile_webhook_phone'))data=mode==='conflict'?{status:'identity_conflict',reason:'verified_phone_conflict'}:{status:mode==='merge'?'merged':'unchanged',customer_master_id:'keep'};
 else if(path.includes('/marketplace_orders?'))data=[{id:'order',order_sn:'QA-ORDER',buyer_customer_id:'market',buyer_username:'buyer',buyer_user_id:'user'}];
 else if(path.includes('/marketplace_customers?'))data=[{id:'market',customer_master_id:'old',username:'buyer',provider_user_id:'user'}];
 else if(path.includes('/crm_clickup_import_rows'))data=[];
 else if(path.includes('/customer_master?primary_phone_normalized'))data=[{id:'keep'}];
 else if(path.includes('/customer_master?id'))data=opt.method==='PATCH'?[]:[{id:'keep',primary_phone_normalized:'60139091918'}];
 else throw Error('Unexpected route '+path);
 return Response.json(data);
};
try{
 fs.writeFileSync(modulePath,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);await import(pathToFileURL(modulePath).href);
 const call=async(body,token=fixtureToken)=>{const response=await handler(new Request('https://fixture.local/crm-identity-ingest?token='+token,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};};
 const input={order_sn:'QA-ORDER',shopee_username:'buyer',shopee_user_id:'user',phone:'0139091918'};
 assert.equal((await call(input,'wrong')).status,401);assert.equal(calls.length,0);
 let result=await call(input);assert.equal(result.body.results[0].result.status,'merged');assert.equal(result.body.results[0].result.customer_master_id,'keep');assert.equal(calls.find(c=>c.path.includes('/rpc/')).body.p_phone,'60139091918');
 mode='unchanged';calls=[];result=await call(input);assert.equal(result.body.results[0].result.status,'unchanged');assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
 mode='conflict';calls=[];result=await call(input);assert.equal(result.body.results[0].result.reason,'verified_phone_conflict');assert.equal(calls.filter(c=>c.method==='PATCH').length,0);
 calls=[];result=await call({...input,shopee_username:'someone-else'});assert.equal(result.body.results[0].result.reason,'order_username_mismatch');assert(!calls.some(c=>c.path.includes('/rpc/')));
 calls=[];result=await call({...input,mode:'import',clickup_id:'task'});assert.equal(result.body.results[0].result.status,'identity_conflict');assert(!calls.some(c=>c.path.includes('/rpc/')),'CSV cannot auto merge');
 calls=[];result=await call({...input,order_sn:undefined});assert.equal(result.body.results[0].result.status,'identity_conflict');assert(!calls.some(c=>c.path.includes('/rpc/')),'username/user-only cannot auto merge');
 console.log('PASS: actual ingest handler token gate, verified exact-order reconciliation, repeat, conflict no-write, username mismatch, CSV and reference-free exclusions.');
}finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;fs.rmSync(work,{recursive:true,force:true});}
