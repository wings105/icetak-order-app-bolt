const assert=require('node:assert/strict');
const path=require('node:path');
const {createRequire}=require('node:module');
const taskRoot=process.cwd();
const qaRoot=process.env.ICETAK_QA_DIR||'/tmp/icetak-automation-qa';
const projectRequire=createRequire(path.join(taskRoot,'package.json'));
const esbuild=projectRequire('esbuild');
const {JSDOM}=createRequire(path.join(qaRoot,'package.json'))('jsdom');
const dom=new JSDOM('<html><body><div id="root"></div></body></html>',{url:'http://localhost/',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement','Event','MouseEvent','Node'])global[key]=dom.window[key];
global.IS_REACT_ACT_ENVIRONMENT=true;
const sampleRules=[['prepaid','Draft prepaid','#ok','draft_prepaid'],['pickup','Pay at pickup','#noted','draft_pickup'],['qr','Hantar gambar QR','#qr','send_qr']].map(([id,name,keyword,action])=>({id,name,keyword,action,mode:'observe',revision:1,case_sensitive:false,rate_per_hour:60,config:{},counts:{},last_run_at:null}));
const run={id:'11111111-1111-4111-8111-111111111111',rule_id:'prepaid',action:'draft_prepaid',status:'failed',reason:'REQUEST_FAILED',message_text:'Order disahkan #ok',message_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),customer_name:'QA Customer',phone:'60111111111',conversation_id:'22222222-2222-4222-8222-222222222222',provider_message_id:'qa-message',attempts:1,rule_snapshot:sampleRules[0],result:{}};
let calls=[];
global.__automationApi=async({action,payload})=>{
 calls.push({action,payload});
 let data;
 if(action==='snapshot'){let rows=[run].filter(r=>(!payload.rule||r.rule_id===payload.rule)&&(!payload.status||r.status===payload.status));data={rules:sampleRules,runs:rows,total:rows.length,totals:{failed:1},health:{last_worker_at:new Date().toISOString()}};}
 else if(action==='save'){const r=sampleRules.find(r=>r.id===payload.id);Object.assign(r,payload,{revision:r.revision+1});data={saved:true};}
 else if(action==='preview'){data={eligible:payload.direction==='outbound',matches:sampleRules.filter(r=>payload.text.toLowerCase().includes(r.keyword.toLowerCase())).map(r=>({...r,would_run:r.mode==='native'}))};}
 else if(action==='detail')data={run,events:[{id:1,event:'matched',actor:'message-trigger',created_at:run.created_at,data:{}},{id:2,event:'attempt_finished',actor:'worker',created_at:run.created_at,data:{reason:'REQUEST_FAILED'}}]};
 else if(action==='retry'){run.status='pending';data={queued:true};}
 return {data:{ok:true,data,can_manage:true},error:null};
};
async function main(){
await esbuild.build({stdin:{contents:`import React,{act} from 'react';import {createRoot} from 'react-dom/client';import Automation from '${taskRoot}/icetak-admin/src/pages/Automation.tsx';export {act};export function mount(node){const root=createRoot(node);root.render(React.createElement(Automation));return root;}`,resolveDir:taskRoot,loader:'tsx'},outfile:path.join(qaRoot,'component.cjs'),bundle:true,format:'cjs',platform:'browser',jsx:'automatic',loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'mock-transport',setup(build){build.onResolve({filter:/lib\/supabase$/},()=>({path:'mock-supabase',namespace:'qa'}));build.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const supabase={functions:{invoke:async(name,{body})=>globalThis.__automationApi(body)}};'}));}}]});

const {act,mount}=require(path.join(qaRoot,'component.cjs'));
let root;await act(async()=>{root=mount(document.getElementById('root'));});
await act(async()=>{await new Promise(r=>setTimeout(r,350));});
assert.equal(document.querySelectorAll('.auto-rule').length,3);
assert.match(document.body.textContent,/Draft prepaid/);
const button=(text,scope=document)=>{const b=[...scope.querySelectorAll('button')].find(x=>x.textContent.trim()===text);assert.ok(b,'button '+text);return b;};
await act(async()=>button('Tetapan',document.querySelector('.auto-rule')).click());
assert.ok(document.querySelector('[role=dialog]'));
await act(async()=>{const select=document.querySelector('.auto-dialog select');select.value='native';select.dispatchEvent(new Event('change',{bubbles:true}));});
assert.equal(button('Simpan tetapan').disabled,true);
const checks=[...document.querySelectorAll('.auto-dialog input[type=checkbox]')];
await act(async()=>checks.at(-1).click());assert.equal(button('Simpan tetapan').disabled,false);
await act(async()=>{button('Simpan tetapan').click();await new Promise(r=>setTimeout(r,30));});
assert.equal(sampleRules[0].mode,'native');assert.equal(calls.find(c=>c.action==='save').payload.external_disabled,true);
assert.match(document.querySelector('[role=status]').textContent,/disimpan/);
await act(async()=>button('Uji padanan').click());
await act(async()=>{button('Uji padanan',document.querySelector('.auto-test')).click();await new Promise(r=>setTimeout(r,20));});
assert.match(document.querySelector('.auto-preview').textContent,/Draft prepaid/);
await act(async()=>{const select=document.querySelector('.auto-test select');select.value='inbound';select.dispatchEvent(new Event('change',{bubbles:true}));});
await act(async()=>{button('Uji padanan',document.querySelector('.auto-test')).click();await new Promise(r=>setTimeout(r,20));});
assert.match(document.querySelector('.auto-preview').textContent,/Mesej buyer ditapis/);
await act(async()=>button('Rekod run').click());
assert.match(document.querySelector('tbody').textContent,/QA Customer/);
await act(async()=>{button('Butiran').click();await new Promise(r=>setTimeout(r,20));});
assert.equal(document.querySelectorAll('.auto-timeline li').length,2);
assert.match(document.querySelector('[role=dialog]').textContent,/qa-message/);
await act(async()=>{button('Cuba semula run ini').click();await new Promise(r=>setTimeout(r,20));});
assert.equal(run.status,'pending');assert.equal(calls.filter(c=>c.action==='retry').length,1);
await act(async()=>button('Tutup').click());
await act(async()=>root.unmount());dom.window.close();
console.log('PASS actual React component DOM: 3 rules, settings drawer, native takeover guard, save, outbound/inbound preview, history, event details and safe retry; synthetic transport only, no visual-browser claim');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);dom.window.close();process.exit(1);});
