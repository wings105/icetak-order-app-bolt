import {attachDetailSources} from '../admin-ai-dashboard/order-details.ts';
import {focusRows} from '../admin-ai-dashboard/focus.ts';
import {identity} from '../admin-ai-dashboard/analysis.ts';
import {taskReadiness} from './readiness.ts';
type Data=Record<string,any>;
type Rpc=(name:string,body:unknown)=>Promise<any>;
export async function loadReadiness(tasks:Data[],rpc:Rpc,call:(path:string,init?:RequestInit)=>Promise<any>){
 if(!tasks.length)return {};
 const source=await rpc('icetak_task_readiness_sources',{p_task_ids:tasks.map(t=>t.task_id)});
 const keys=[...new Set(tasks.map(t=>t.marketplace_order_id?`shopee:${t.marketplace_order_id}`:t.order_id?`icetak:${t.order_id}`:'').filter(Boolean))];
 const orders:Data={},contexts:Data={};
 let unavailable=false;
 async function inbox(body:unknown,media=false){
  const rows=await call('/rest/v1/private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  if(!rows[0]?.setting_value)throw Error('INBOX_UNAVAILABLE');
  const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/'+(media?'task-brief-media':'ai-dashboard-bridge'),{
   method:'POST',headers:{'content-type':'application/json','x-admin-window-token':rows[0].setting_value},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
  const data=await r.json();if(!r.ok||data.ok===false)throw Error('INBOX_UNAVAILABLE');return data;
 }
 try{
  for(let n=0;n<keys.length;n+=50){
   const batch=keys.slice(n,n+50);
   const [snapshot,details]=await Promise.all([rpc('icetak_customer_focus_orders',{p_keys:batch}),rpc('icetak_order_detail_sources',{p_keys:batch})]);
   snapshot.orders=(snapshot.orders||[]).filter((o:Data)=>batch.includes(`${o.kind}:${o.id}`));attachDetailSources(snapshot,details);
   for(const o of snapshot.orders){const k=`${o.kind}:${o.id}`;o.state=snapshot.states?.[k]||{data:{}};orders[k]=o;}
   const manual=snapshot.orders.filter((o:Data)=>o.state.data?.detail_check?.bindings?.length);
   let approved:Data={};
   // Rare manual bindings retain the existing current-identity validation. Automatic links use the narrow session RPC only.
   if(manual.length){
    const chats=await inbox({action:'focus'});if(chats.truncated)throw Error('CHAT_IDENTITY_INCOMPLETE');
    const identities=await rpc('icetak_customer_focus_identities',{p_identities:chats.rows.map(identity)});
    approved=Object.fromEntries(focusRows(snapshot,chats.rows,identities).map((o:Data)=>[o.key,new Set((o.conversations||[]).filter((c:Data)=>identities[c.id]?.identity_status!=='ambiguous').map((c:Data)=>c.id))]));
   }
   const requests=snapshot.orders.map((o:Data)=>{
    const k=`${o.kind}:${o.id}`,saved=o.state.data?.detail_check?.bindings||[];
    return {key:k,reference:o.reference,placed_at:o.created_at||o.placed_at,single_item_scope:o.items?.length===1,closed:/^(shipped|completed|cancelled|canceled|customer_collected|returned|refunded)$/i.test(o.status||''),
     bindings:saved.filter((b:Data)=>approved[k]?.has(b.conversation_id)),invalid:saved.some((b:Data)=>!approved[k]?.has(b.conversation_id))};
   });
   if(requests.length){const data=await inbox({action:'context',orders:requests},true);
    for(const r of requests)contexts[r.key]=r.invalid?{ambiguous:true,bindings:[],messages:[]}:data.contexts?.[r.key]||{unavailable:true};
   }
  }
 }catch{unavailable=true;}
 const mediaIds=[...new Set<string>(Object.values(contexts).flatMap((c:Data)=>(c.messages||[]).filter((m:Data)=>m.direction==='inbound'&&!m.is_history&&c.bindings?.some((b:Data)=>b.usable&&b.id===m.conversation_id)).map((m:Data)=>String(m.media_url||''))).filter((v:string)=>/^wasapflow-media:\/\/\d{1,40}$/.test(v)))];
 let mediaAccess:Data={};
 for(let n=0;n<mediaIds.length;n+=20){try{Object.assign(mediaAccess,(await inbox({ids:mediaIds.slice(n,n+20).map(v=>v.slice('wasapflow-media://'.length))},true)).media);}catch{/* Unknown artwork stays blocked; textual details can still be reviewed. */}}
 const result:Data={};
 await Promise.all(tasks.map(async t=>{
  const k=t.marketplace_order_id?`shopee:${t.marketplace_order_id}`:t.order_id?`icetak:${t.order_id}`:'';
  const s=source.sources?.[t.task_id];if(!s)throw Error('SOURCE_CHANGED_REFRESH');
  const o=orders[k]||null,c=contexts[k]||{},allowedMedia=new Set((c.messages||[]).filter((m:Data)=>m.direction==='inbound'&&!m.is_history&&c.bindings?.some((b:Data)=>b.usable&&b.id===m.conversation_id)).map((m:Data)=>m.media_url));
  const context=k?(unavailable||!o?{unavailable:true}:{...c,media_access:Object.fromEntries(Object.entries(mediaAccess).filter(([url])=>allowedMedia.has(url)))}):{};
  result[t.task_id]={source:s,order:o,context,saved:source.briefs?.[t.task_id]||null,
   readiness:await taskReadiness(s,o,context,source.briefs?.[t.task_id]||null)};
 }));
 return result;
}
