import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {mapFields,taskEligible} from './mapping.js';
type Obj=Record<string,any>;
const BASE=Deno.env.get('SUPABASE_URL')||'',KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={apikey:KEY,authorization:'Bearer '+KEY,'content-type':'application/json'};
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
async function db(path:string,body?:unknown){
 const r=await fetch(BASE+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('DATABASE_'+r.status);return r.json();
}
async function setting(key:string){return (await db('private_runtime_settings?setting_key=eq.'+encodeURIComponent(key)+'&select=setting_value&limit=1'))[0]?.setting_value||'';}
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
async function sha(s:string){return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
async function same(a:string,b:string){if(!a||!b)return false;const [x,y]=await Promise.all([sha(a),sha(b)]);let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0;}
async function task(token:string,id:string){
 const r=await fetch('https://api.clickup.com/api/v2/task/'+encodeURIComponent(id),{headers:{authorization:token},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('CLICKUP_READ_'+r.status);return r.json();
}
async function template(sku:string){return (await db('render_templates?sku=eq.'+encodeURIComponent(sku)+'&select=sku,image_path,font_path,config,version&limit=1'))[0];}
async function signedRender(t:Obj,fields:Obj){
 const expires=Math.floor(Date.now()/1000)+300;
 const payload=JSON.stringify({sku:t.sku,fields:Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)),version:t.version,expires});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
 const r=await fetch('https://shop.decocake.my/render-test/output.png',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sku:t.sku,fields,version:t.version,expires,sig}),redirect:'error',signal:AbortSignal.timeout(95000)});
 if(!r.ok||!r.headers.get('content-type')?.startsWith('image/png'))throw Error('RENDER_'+r.status);
 const bytes=new Uint8Array(await r.arrayBuffer());
 if(bytes.length>16*1024*1024||bytes.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')throw Error('INVALID_PNG');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(view.getUint32(16)!==t.config.width||view.getUint32(20)!==t.config.height)throw Error('PNG_DIMENSIONS_CHANGED');
 return bytes;
}
export async function process(job:Obj,token:string){
 const record=(patch:Obj)=>db('rpc/icetak_render_auto_record',{p_task_id:job.task_id,p_lease:job.lease_token,p_patch:patch});
 const finish=async(state:string,error='',extra:Obj={})=>({task_id:job.task_id,state,saved:await record({state,error,...extra})});
 try{
  const current=await task(token,job.task_id),guard=taskEligible(current,job);
  if(!guard.ok)return finish('review',guard.reason);
  const old=(current.attachments||[]).find((a:Obj)=>job.filename&&(a.title===job.filename||a.name===job.filename));
  if(old)return finish('completed','',{attachment_id:old.id,attachment_url:old.url});
  if(job.upload_started_at)return finish('uncertain','UPLOAD_RECEIPT_REQUIRES_RECONCILIATION');
  const t=await template(job.brief.sku);
  if(!t)return finish('skipped','TEMPLATE_NOT_FOUND');
  const mapped=mapFields(t,job.brief,guard.wording);
  if(!mapped.ok)return finish('review',mapped.reason);
  const fingerprint=await sha(JSON.stringify({engine:'native-autobrief-1',sku:t.sku,version:t.version,fields:mapped.fields}));
  const filename=t.sku+'-'+job.task_id+'-'+fingerprint.slice(0,24)+'.png';
  const existing=(current.attachments||[]).find((a:Obj)=>a.title===filename||a.name===filename);
  if(existing)return finish('completed','',{filename,fields:mapped.fields,template_version:t.version,attachment_id:existing.id,attachment_url:existing.url});
  if(!await record({fields:mapped.fields,template_version:t.version,filename}))return {task_id:job.task_id,state:'superseded'};
  const bytes=await signedRender(t,mapped.fields);
  // All slow work precedes this final source/task/template revision check.
  const [fresh,latest,valid]=await Promise.all([task(token,job.task_id),template(t.sku),db('rpc/icetak_render_auto_source',{p_task_id:job.task_id,p_hash:job.source_hash})]);
  const finalGuard=taskEligible(fresh,job);
  if(!valid||!finalGuard.ok||latest?.version!==t.version)return finish('review','SOURCE_OR_TEMPLATE_CHANGED');
  const receipt=(fresh.attachments||[]).find((a:Obj)=>a.title===filename||a.name===filename);
  if(receipt)return finish('completed','',{attachment_id:receipt.id,attachment_url:receipt.url});
  if(!await record({upload_started:true}))return {task_id:job.task_id,state:'superseded'};
  const form=new FormData();form.append('attachment',new Blob([bytes],{type:'image/png'}),filename);
  // Once POST starts, an unknown result must reconcile; it must never blindly resend.
  let uploaded:Obj;
  try{
   const r=await fetch('https://api.clickup.com/api/v2/task/'+encodeURIComponent(job.task_id)+'/attachment',{method:'POST',headers:{authorization:token},body:form,redirect:'error',signal:AbortSignal.timeout(45000)});
   if(!r.ok)return finish('uncertain','UPLOAD_HTTP_'+r.status);
   uploaded=await r.json();
  }catch{return finish('uncertain','UPLOAD_RESULT_UNKNOWN');}
  if(!uploaded.id)return finish('uncertain','UPLOAD_RECEIPT_MISSING');
  const proof=await task(token,job.task_id);
  if(!(proof.attachments||[]).some((a:Obj)=>a.id===uploaded.id))return finish('uncertain','ATTACHMENT_READBACK_PENDING');
  return finish('completed','',{attachment_id:uploaded.id,attachment_url:uploaded.url});
 }catch(e){return finish('retry',String(e instanceof Error?e.message:e).replace(/[^A-Z0-9_: -]/gi,'').slice(0,120));}
}
Deno.serve(async req=>{
 if(req.method==='GET')return respond({service:'autobrief-render',version:1,delay_seconds:300});
 if(req.method!=='POST')return respond({ok:false,error:'METHOD_NOT_ALLOWED'},405);
 try{
  const expected=await setting('order_brief_worker_token');
  if(!await same(req.headers.get('x-order-brief-token')||'',expected))return respond({ok:false,error:'UNAUTHORIZED'},401);
  const input=await req.json().catch(()=>({}));
  if(input.action==='status')return respond({ok:true,...await db('rpc/icetak_render_auto_status',{})});
  if(input.action!=='run')return respond({ok:false,error:'INVALID_ACTION'},400);
  const token=await setting('clickup_designer_api_token');
  if(!token)return respond({ok:false,error:'CLICKUP_NOT_CONFIGURED'},503);
  const job=await db('rpc/icetak_render_auto_claim',{});
  return respond({ok:true,result:job?await process(job,token):null});
 }catch{return respond({ok:false,error:'RENDER_WORKER_FAILED'},502);}
});
