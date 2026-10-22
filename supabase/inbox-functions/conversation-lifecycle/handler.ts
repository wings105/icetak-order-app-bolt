import { conversationLifecycle, type HeaderSource, type HeaderCanonical, type HeaderTask } from '../../functions/_shared/conversation-lifecycle.ts';
type Dependencies={source:(req:Request,id:string)=>Promise<HeaderSource>;canonical:(source:HeaderSource)=>Promise<{canonical:HeaderCanonical;works:Array<{id:string;source_channel:string;placed_at?:string|null;tasks:HeaderTask[]}>}>;save:(req:Request,id:string,scope:string,stage:string|null)=>Promise<void>};
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS','cache-control':'no-store'};
const out=(b:unknown,status=200)=>Response.json(b,{status,headers:cors});
export function lifecycleHandler(deps:Dependencies){return async(req:Request)=>{
 if(req.method==='OPTIONS')return out({});if(req.method!=='POST')return out({ok:false},405);
 if(!/^Bearer\s+\S+$/i.test(req.headers.get('authorization')||''))return out({ok:false,error:'Log masuk staf diperlukan.'},401);
 try{
  const b=await req.json(),id=String(b.conversation_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!['read','set_prospect'].includes(b.action||'read'))return out({ok:false,error:'Permintaan tidak sah.'},400);
  const source=await deps.source(req,id);const {canonical,works}=await deps.canonical(source);
  for(const order of source.orders){const work=works.find(w=>w.id===order.id&&w.source_channel===order.source_channel);if(work){order.tasks=work.tasks;order.placed_at=work.placed_at||order.placed_at;}}
  let lifecycle=conversationLifecycle(source,canonical);
  if(b.action==='set_prospect'){
   if(!lifecycle.prospect_editable||b.scope_key!==lifecycle.scope_key)return out({ok:false,error:'Sesi/order berubah. Muat semula status.'},409);
   if(b.stage!==null&&!['survey','interested','awaiting_confirm','not_proceeding'].includes(b.stage))return out({ok:false,error:'Tahap prospek tidak sah.'},400);
   await deps.save(req,id,lifecycle.scope_key,b.stage);
   source.prospect={stage:b.stage,scope_key:lifecycle.scope_key,updated_at:new Date().toISOString()};lifecycle=conversationLifecycle(source,canonical);
  }
  // No browser-supplied identity/order/status is trusted. Re-read selection context in the client.
  return out({ok:true,lifecycle});
 }catch(e){const code=(e as {code?:string})?.code;return out({ok:false,error:code==='42501'?'Akses staf aktif diperlukan.':'Status belum tersedia. Cuba semak semula.'},code==='42501'?403:503);}
};}
