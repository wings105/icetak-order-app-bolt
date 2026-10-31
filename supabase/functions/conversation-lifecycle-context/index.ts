// Private, read-only Order System bridge for a selected Inbox conversation.
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function read(path:string,body?:unknown){const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Canonical context unavailable');return await r.json();}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false},405);
 try{
  const settings=await read('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token=req.headers.get('x-admin-window-token');if(!token||token!==settings[0]?.setting_value)return out({ok:false},401);
  const input=await req.json();const batch=Array.isArray(input.requests);const requests=batch?input.requests:[input];const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(requests.length<1||requests.length>40||requests.some((b:any)=>!uuid.test(b.conversation_id)||!Array.isArray(b.orders)||b.orders.length>20||b.orders.some((o:any)=>!uuid.test(o.id)||!uuid.test(o.cache_id)||!['shopee','whatsapp'].includes(o.source_channel))))return out({ok:false},400);
  const orders=requests.flatMap((b:any)=>b.orders);
  // Exact conversation only: no phone fallback can attach a different purchase session.
  const identities=requests.map((b:any)=>({id:b.conversation_id,phone:null,master_id:null,shopee_user_id:null}));
  const ids=[...new Set(orders.map((o:any)=>o.id))];
  const directIds=orders.filter((o:any)=>o.source_channel==='whatsapp').map((o:any)=>o.id),marketIds=orders.filter((o:any)=>o.source_channel==='shopee').map((o:any)=>o.id);
  async function rows(table:string,select:string,ids:string[]){const result:any[]=[];const unique=[...new Set(ids)];for(let i=0;i<unique.length;i+=80)result.push(...await read(`${table}?select=${select}&id=in.(${unique.slice(i,i+80).join(',')})`));return result;}
  const [contexts,work,direct,market]=await Promise.all([read('rpc/icetak_ai_dashboard_context',{p_identities:identities}),rows('ai_order_work_source','id,kind,production_tasks',ids as string[]),rows('orders','id,created_at',directIds),rows('marketplace_orders','id,placed_at',marketIds)]);
  const results=requests.map((b:any)=>{
   const ctx=contexts[b.conversation_id];if(!ctx)throw Error('Missing canonical session');
   const works=work.filter((o:any)=>b.orders.some((r:any)=>r.id===o.id&&r.source_channel===(o.kind==='shopee'?'shopee':'whatsapp'))).map((o:any)=>({id:b.orders.find((r:any)=>r.id===o.id&&r.source_channel===(o.kind==='shopee'?'shopee':'whatsapp'))?.cache_id,source_channel:o.kind==='shopee'?'shopee':'whatsapp',placed_at:o.kind==='shopee'?market.find((r:any)=>r.id===o.id)?.placed_at:direct.find((r:any)=>r.id===o.id)?.created_at,tasks:(o.production_tasks||[]).map((t:any)=>({id:t.id,title:String(t.title||'').slice(0,160),status:t.status||'',review_status:t.review_status||null,url:t.url||null,updated_at:t.source_updated_at||t.observed_at||null}))}));
   return {conversation_id:b.conversation_id,canonical:{session:{session_id:ctx.session?.session_id,session_status:ctx.session?.session_status,opened_at:ctx.session?.opened_at,boundary_at:ctx.session?.boundary_at},drafts:ctx.drafts||[]},works};
  });
  return out(batch?{ok:true,results}:{ok:true,...results[0]});
 }catch{return out({ok:false,error:'Konteks order belum tersedia.'},503);}
});
