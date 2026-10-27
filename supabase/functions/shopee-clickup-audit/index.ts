import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {ORDER,SET,value,assess} from './compare.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(b:any,s=200)=>Response.json(b,{status:s,headers:{'cache-control':'no-store'}});
async function db(path:string,body?:any){const r=await fetch(U+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:'Bearer '+K,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error('AUDIT_DATABASE_'+r.status);return d;}
const rpc=(action:string,body:any={},key?:string)=>db('rpc/shopee_clickup_audit_runtime',{p_action:action,p_body:body,p_key:key||null});
const safe=(e:any)=>/^[A-Z0-9_.:-]{1,150}$/.test(String(e?.message))?e.message:'AUDIT_REQUEST_FAILED';
async function notify(){
 const j=await rpc('claim_notification');if(!j.id)return {idle:true};let submitted=false;
 try{
  const sw=(await db('whatsapp_settings?key=eq.enabled&select=value,text_value'))?.[0];if(![true,'true','1','on'].includes(sw?.text_value||sw?.value))throw Error('WHATSAPP_DISABLED');
  submitted=true;const r=await fetch(U+'/functions/v1/whatsapp-send',{method:'POST',headers:{authorization:'Bearer '+K,'content-type':'application/json'},body:JSON.stringify({event_type:'shopee_clickup_audit',phone:j.phone,text:j.message,mode:'auto',idempotency_key:'shopee-clickup-audit:'+j.id,source:'shopee-clickup-audit'}),signal:AbortSignal.timeout(30000)});
  const d=await r.json();if(!r.ok||d.ok===false){submitted=r.status>=500||/uncertain|unknown|timeout|network/i.test(String(d.error||''));throw Error(String(d.error||'NOTIFICATION_REJECTED'));}
  if(!d.message_id)throw Error('DELIVERY_RESULT_UNKNOWN');
  await rpc('notification_result',{id:j.id,provider_id:String(d.message_id)});return {accepted:true};
 }catch(e){const raw=String((e as Error).message);const uncertain=submitted;const code=/^[\w.:-]{1,150}$/.test(raw)?raw:'NOTIFICATION_UNAVAILABLE';await rpc('notification_result',{id:j.id,error:code,uncertain});return {accepted:false,uncertain,error:code};}
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 let run:any=null;
 try{
  const key=req.headers.get('x-audit-worker-key');if(!key||!(await rpc('auth',{},key)).ok)return out({ok:false},401);
  const body=await req.json().catch(()=>({}));if(body.notify_only)return out({ok:true,notification:await notify()});
  run=await rpc('start',{run_key:body.run_key});if(!run.id)return out({ok:true,...run});
  const settings=await db('private_runtime_settings?setting_key=in.(admin_window_bridge_token,clickup_designer_api_token)&select=setting_key,setting_value');
  const config=Object.fromEntries(settings.map((r:any)=>[r.setting_key,r.setting_value]));
  if(!config.admin_window_bridge_token||!config.clickup_designer_api_token)throw Error('AUDIT_CONNECTION_NOT_CONFIGURED');
  const pr=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-order-audit-source',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':config.admin_window_bridge_token},body:'{}',signal:AbortSignal.timeout(120000)});
  const source=await pr.json();if(!pr.ok||!source.ok||!source.complete||!Array.isArray(source.orders))throw Error(source.error||'SHOPEE_SNAPSHOT_INCOMPLETE');
  const orders=source.orders,started=Date.now();let reads=0;
  const api=async(path:string)=>{if(++reads>180||Date.now()-started>100000)throw Error('CLICKUP_AUDIT_READ_LIMIT');const r=await fetch('https://api.clickup.com/api/v2/'+path,{headers:{authorization:config.clickup_designer_api_token},redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('CLICKUP_HTTP_'+r.status);return await r.json();};
  const wanted=new Set(orders.map((o:any)=>o.order_sn)),found=new Map<string,any>();
  const oldest=orders.length?Math.min(...orders.map((o:any)=>Number(o.create_time)||Date.now()/1000)):Date.now()/1000;
  const cutoff=Math.max(0,Math.floor((oldest-7*86400)*1000));
  for(const list of ['18375902','901612769752']){
   for(let page=0;page<60;page++){
    const d=await api('list/'+list+'/task?'+new URLSearchParams({include_closed:'true',subtasks:'true',page:String(page),date_created_gt:String(cutoff)}));
    if(!Array.isArray(d.tasks))throw Error('CLICKUP_INVALID_TASK_LIST');for(const t of d.tasks)if(wanted.has(value(t,ORDER)))found.set(t.id,t);
    if(d.last_page===true||d.tasks.length<100)break;if(page===59)throw Error('CLICKUP_PAGINATION_LIMIT');
   }
  }
  // Exact lookup also catches reused older tasks outside the scan window.
  for(const o of orders.filter((o:any)=>![...found.values()].some(t=>value(t,ORDER)===o.order_sn))){
   for(const list of ['18375902','901612769752']){
    for(let page=0;page<10;page++){
     const d=await api('list/'+list+'/task?'+new URLSearchParams({include_closed:'true',subtasks:'true',page:String(page),custom_fields:JSON.stringify([{field_id:ORDER,operator:'==',value:o.order_sn}])}));
     if(!Array.isArray(d.tasks))throw Error('CLICKUP_INVALID_TASK_LIST');for(const t of d.tasks)if(value(t,ORDER)===o.order_sn)found.set(t.id,t);
     if(d.last_page===true||d.tasks.length<100)break;if(page===9)throw Error('CLICKUP_PAGINATION_LIMIT');
    }
   }
  }
  const issues:any[]=[],mapping:any[]=[];let active=0,closed=0;
  for(const o of orders){
   const tasks=[...found.values()].filter(t=>value(t,ORDER)===o.order_sn),comments:string[]=[];
   if(tasks.length&&tasks.length<o.items.length){for(const t of tasks){let params='';for(let page=0;page<20;page++){
    const d=await api('task/'+t.id+'/comment'+params);if(!Array.isArray(d.comments))throw Error('CLICKUP_INVALID_COMMENTS');comments.push(...d.comments.map((c:any)=>c.comment_text||''));
    if(d.comments.length<25)break;const last=d.comments.at(-1);if(!last?.id||!last?.date)throw Error('CLICKUP_COMMENT_CURSOR');params='?'+new URLSearchParams({start:String(last.date),start_id:last.id});if(page===19)throw Error('CLICKUP_COMMENT_LIMIT');
   }}}
   const findings=assess(o,tasks,comments);
   // Allow normal webhook/Make propagation; report on the next audit rather
   // than flagging an order that arrived while this snapshot was being taken.
   if(Date.now()/1000-Number(o.create_time)>600)issues.push(...findings);
   const allClosed=tasks.length>0&&tasks.every(t=>['closed','done'].includes(t.status?.type));if(tasks.length)(allClosed?closed++:active++);
   mapping.push({order_sn:o.order_sn,shop_id:o.shop_id,items:o.items.length,tasks:tasks.map(t=>({id:t.id,status:t.status?.status,set:value(t,SET)||[],url:'https://app.clickup.com/t/'+t.id})),findings:findings.length,grace_period:Date.now()/1000-Number(o.create_time)<=600});
  }
  const labels:any={missing_order:'Order tiada task ClickUp',extra_or_duplicate_tasks:'Task berlebihan / pendua',missing_item_or_unverified_combination:'Item kurang / gabungan belum disahkan',duplicate_set:'Set berulang',item_match_requires_review:'Padanan item perlu semakan',quantity_mismatch:'Kuantiti item tidak sepadan'};
  for(const i of issues){i.title=labels[i.kind];i.body=i.order_sn+' — '+i.title;i.url=i.detail.task_ids?.[0]?'https://app.clickup.com/t/'+i.detail.task_ids[0]:'https://shop.decocake.my/?admin=v2';}
  const summary={checked_at:new Date().toISOString(),window_days:90,shops:source.shops,orders:orders.length,items:orders.reduce((n:number,o:any)=>n+o.items.length,0),tasks:found.size,active_orders:active,complete_orders:closed,issues:issues.length,provider_reads:source.provider_reads,clickup_reads:reads,mapping};
  const message=['⚠️ ICETAK — SEMAK SHOPEE / CLICKUP',new Date().toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'}),'Shopee: '+summary.orders+' order / '+summary.items+' item','ClickUp: '+summary.tasks+' task','Masalah: '+issues.length,...issues.slice(0,15).map(i=>i.body+'\n'+i.url),issues.length>15?'Lagi '+(issues.length-15)+' masalah dalam Marketplace Operations.':'','Sila semak: https://shop.decocake.my/?admin=v2'].filter(Boolean).join('\n');
  await rpc('finish',{id:run.id,summary,issues,message});return out({ok:true,run_id:run.id,orders:summary.orders,tasks:summary.tasks,issues:issues.length,notification:await notify()});
 }catch(e){const error=safe(e);if(run?.id){await rpc('finish',{id:run.id,error,summary:{complete:false},issues:[{kind:'audit_unavailable',title:'Semakan Shopee / ClickUp gagal',body:error,detail:{code:error}}],message:'⚠️ ICETAK: semakan Shopee / ClickUp gagal — '+error+'. Sila semak sambungan API. https://shop.decocake.my/?admin=v2'});return out({ok:false,error,notification:await notify()},503);}return out({ok:false,error},503);}
});
