// Private, read-only Order System bridge for a selected Inbox conversation.
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function read(path:string,body?:unknown){const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Canonical context unavailable');return await r.json();}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const settings=await read('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token=req.headers.get('x-admin-window-token');if(!token||token!==settings[0]?.setting_value)return out({ok:false},401);
  const b=await req.json();const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(!uuid.test(b.conversation_id)||!Array.isArray(b.orders)||b.orders.length>20||b.orders.some((o:any)=>!uuid.test(o.id)||!uuid.test(o.cache_id)||!['shopee','whatsapp'].includes(o.source_channel)))return out({ok:false},400);
  // Exact conversation only: no phone fallback can attach a different purchase session.
  const identities=[{id:b.conversation_id,phone:null,master_id:null,shopee_user_id:null}];
  const ids=[...new Set(b.orders.map((o:any)=>o.id))];
  const directIds=b.orders.filter((o:any)=>o.source_channel==='whatsapp').map((o:any)=>o.id),marketIds=b.orders.filter((o:any)=>o.source_channel==='shopee').map((o:any)=>o.id);
  const [contexts,work,direct,market]=await Promise.all([read('rpc/icetak_ai_dashboard_context',{p_identities:identities}),ids.length?read(`ai_order_work_source?select=id,kind,production_tasks&id=in.(${ids.join(',')})`):Promise.resolve([]),directIds.length?read(`orders?select=id,created_at&id=in.(${directIds.join(',')})`):Promise.resolve([]),marketIds.length?read(`marketplace_orders?select=id,placed_at&id=in.(${marketIds.join(',')})`):Promise.resolve([])]);
  const ctx=contexts[b.conversation_id];if(!ctx)throw Error('Missing canonical session');
  const works=work.map((o:any)=>({id:b.orders.find((r:any)=>r.id===o.id&&r.source_channel===(o.kind==='shopee'?'shopee':'whatsapp'))?.cache_id,source_channel:o.kind==='shopee'?'shopee':'whatsapp',placed_at:o.kind==='shopee'?market.find((r:any)=>r.id===o.id)?.placed_at:direct.find((r:any)=>r.id===o.id)?.created_at,tasks:(o.production_tasks||[]).map((t:any)=>({id:t.id,title:String(t.title||'').slice(0,160),status:t.status||'',review_status:t.review_status||null,url:t.url||null,updated_at:t.source_updated_at||t.observed_at||null}))}));
  return out({ok:true,canonical:{session:{session_id:ctx.session?.session_id,session_status:ctx.session?.session_status,opened_at:ctx.session?.opened_at,boundary_at:ctx.session?.boundary_at},drafts:ctx.drafts||[]},works});
 }catch{return out({ok:false,error:'Konteks order belum tersedia.'},503);}
});
