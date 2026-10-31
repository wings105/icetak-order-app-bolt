import { conversationLifecycle, type HeaderSource, type HeaderCanonical, type HeaderTask } from '../../functions/_shared/conversation-lifecycle.ts';
type Dependencies={source:(req:Request,id:string)=>Promise<HeaderSource>;canonical:(source:HeaderSource)=>Promise<{canonical:HeaderCanonical;works:Array<{id:string;source_channel:string;placed_at?:string|null;tasks:HeaderTask[]}>}>;prepare?:(req:Request,ids:string[],force?:boolean)=>Promise<any[]>;canonicalBatch?:(sources:HeaderSource[])=>Promise<any[]>;records?:(rows:any[])=>Promise<string[]>;record?:(id:string,revision:number,result:ReturnType<typeof conversationLifecycle>)=>Promise<boolean>;save:(req:Request,id:string,scope:string,stage:string|null)=>Promise<void>};
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'POST,OPTIONS','cache-control':'no-store'};
const out=(b:unknown,status=200)=>Response.json(b,{status,headers:cors});
export function lifecycleHandler(deps:Dependencies){return async(req:Request)=>{
 if(req.method==='OPTIONS')return out({});if(req.method!=='POST')return out({ok:false},405);
 if(!/^Bearer\s+\S+$/i.test(req.headers.get('authorization')||''))return out({ok:false,error:'Log masuk staf diperlukan.'},401);
 try{
  const b=await req.json(),id=String(b.conversation_id||'');
  if(b.action==='list'){
   if(!deps.prepare||!deps.canonicalBatch||!deps.record||!Array.isArray(b.conversation_ids)||b.conversation_ids.length<1||b.conversation_ids.length>40||b.conversation_ids.some((v:unknown)=>typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)))return out({ok:false},400);
   const rows=await deps.prepare(req,[...new Set<string>(b.conversation_ids)]);
   const pending=rows.filter(row=>!row.cached);
   const contexts=pending.length?await deps.canonicalBatch(pending.map(row=>row.source)):[];
   const computed=pending.map(row=>{
    const ctx=contexts.find(c=>c.conversation_id===row.id);if(!ctx)throw Error('Missing context');
    const source=row.source;
    for(const order of source.orders){const work=ctx.works.find((w:any)=>w.id===order.id&&w.source_channel===order.source_channel);if(work){order.tasks=work.tasks;order.placed_at=work.placed_at||order.placed_at;}}
    return {row,result:conversationLifecycle(source,ctx.canonical)};
   });
   const accepted=!computed.length?[]:deps.records?await deps.records(computed.map(({row,result})=>({id:row.id,revision:row.revision,stage:result.stage,checked_at:result.checked_at}))):await Promise.all(computed.map(async({row,result})=>await deps.record!(row.id,row.revision,result)?row.id:null));
   const statuses=rows.map(row=>{
    if(row.cached)return {conversation_id:row.id,...row.cached};
    const result=computed.find(c=>c.row.id===row.id)!.result,stored=accepted.includes(row.id);
    return {conversation_id:row.id,stage:stored?result.stage:'unknown',checked_at:stored?result.checked_at:null,pending:!stored};
   });
   return out({ok:true,statuses});
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!['read','set_prospect'].includes(b.action||'read'))return out({ok:false,error:'Permintaan tidak sah.'},400);
  let source=await deps.source(req,id);let {canonical,works}=await deps.canonical(source);
  for(const order of source.orders){const work=works.find(w=>w.id===order.id&&w.source_channel===order.source_channel);if(work){order.tasks=work.tasks;order.placed_at=work.placed_at||order.placed_at;}}
  let lifecycle=conversationLifecycle(source,canonical);
  if(b.action==='set_prospect'){
   if(!lifecycle.prospect_editable||b.scope_key!==lifecycle.scope_key)return out({ok:false,error:'Sesi/order berubah. Muat semula status.'},409);
   if(b.stage!==null&&!['survey','interested','awaiting_confirm','not_proceeding'].includes(b.stage))return out({ok:false,error:'Tahap prospek tidak sah.'},400);
   await deps.save(req,id,lifecycle.scope_key,b.stage);
   source=await deps.source(req,id);
   ({canonical,works}=await deps.canonical(source));
   for(const order of source.orders){const work=works.find(w=>w.id===order.id&&w.source_channel===order.source_channel);if(work){order.tasks=work.tasks;order.placed_at=work.placed_at||order.placed_at;}}
   lifecycle=conversationLifecycle(source,canonical);
  }
  if(deps.record&&!await deps.record(id,(source as any).index_revision,lifecycle))return out({ok:false,error:'Status berubah. Semak semula.'},409);
  // No browser-supplied identity/order/status is trusted. Re-read selection context in the client.
  return out({ok:true,lifecycle});
 }catch(e){const code=(e as {code?:string})?.code;return out({ok:false,error:code==='42501'?'Akses staf aktif diperlukan.':'Status belum tersedia. Cuba semak semula.'},code==='42501'?403:503);}
};}
