import { lifecycleHandler } from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function db(path:string,body?:unknown,authorization=`Bearer ${key}`){const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok){const e=await r.json().catch(()=>({}));throw Object.assign(Error('Read failed'),{code:e.code});}const s=await r.text();return s?JSON.parse(s):null;}
async function prepare(req:Request,ids:string[],force=false){
 const authorization=req.headers.get('authorization')||'';
 try{return await db('rpc/icetak_lifecycle_index_sources',{p_ids:ids,p_force:force},authorization);}
 catch(e){if((e as {code?:string}).code!=='42501')throw e;await db('rpc/ensure_workspace_member',{},authorization);return await db('rpc/icetak_lifecycle_index_sources',{p_ids:ids,p_force:force},authorization);}
}
async function canonicalBatch(sources:any[]){
 const rows=await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');const token=rows[0]?.setting_value;if(!token)throw Error('Missing bridge');
 const r=await fetch('https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/conversation-lifecycle-context',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify({requests:sources.map(source=>({conversation_id:source.conversation.id,orders:source.orders.filter((o:any)=>/^[0-9a-f-]{36}$/i.test(o.canonical_id||'')).map((o:any)=>({id:o.canonical_id,cache_id:o.id,source_channel:o.source_channel}))}))}),redirect:'error',signal:AbortSignal.timeout(25000)});
 const d=await r.json();if(!r.ok||!d.ok)throw Error('Context unavailable');return d.results;
}
Deno.serve(lifecycleHandler({
 async source(req,id){const row=(await prepare(req,[id],true))[0];return {...row.source,index_revision:row.revision};},
 async canonical(source){return (await canonicalBatch([source]))[0];},
 prepare,canonicalBatch,
 records:rows=>db('rpc/icetak_lifecycle_index_store_batch',{p_rows:rows}),
 record:(id,revision,lifecycle)=>db('rpc/icetak_lifecycle_index_store',{p_id:id,p_revision:revision,p_stage:lifecycle.stage,p_checked_at:lifecycle.checked_at}),
 save:(req,id,scope,stage)=>db('rpc/icetak_set_conversation_prospect',{p_conversation_id:id,p_scope_key:scope,p_stage:stage},req.headers.get('authorization')||''),
}));
