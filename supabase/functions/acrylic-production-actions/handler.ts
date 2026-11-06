import {createTaskClickUpHandler} from '../task-clickup/handler.ts';
import {productionItem,type SourceRow} from '../acrylic-production/model.ts';
type Actor={username:string;role:string;permissions:string[]};
type Factory=(o:{url:string;key:string;fetcher?:typeof fetch;trustedActor:Actor})=>(r:Request)=>Promise<Response>;
const cors={'access-control-allow-origin':'https://shop.decocake.my','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type,x-task-service','vary':'Origin','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
const labels=new Set(['FINISHED product Printed','AWB/address printed']);
export async function acrylicDigest(token:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function createAcrylicActionsHandler({url,key,fetcher=fetch,clickup=createTaskClickUpHandler}:{url:string;key:string;fetcher?:typeof fetch;clickup?:Factory}){
 const headers={apikey:key,authorization:'Bearer '+key,'content-type':'application/json'};
 async function db(path:string,body?:unknown){const r=await fetcher(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('UNAVAILABLE');return r.json();}
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({ok:false,error:'POST_REQUIRED'},405);
  if(req.headers.get('origin')&&req.headers.get('origin')!=='https://shop.decocake.my')return reply({ok:false,error:'ORIGIN_NOT_ALLOWED'},403);
  const token=req.headers.get('authorization')?.match(/^Bearer (ap_[a-f0-9]{64})$/)?.[1];
  if(!token)return reply({ok:false,error:'Gunakan link khas PC produksi atau login admin untuk mengemas kini task.'},401);
  try{
   const rows=await db('private_runtime_settings?setting_key=eq.acrylic_production_station&select=setting_value&limit=1');
   let config;try{config=JSON.parse(rows[0]?.setting_value||'null');}catch{return reply({ok:false,error:'Akses PC produksi belum tersedia.'},503);}
   if(!config?.enabled||config.digest!==await acrylicDigest(token)||!/^acrylic_station_[a-f0-9]{8}$/.test(config.actor||''))return reply({ok:false,error:'Link PC produksi tidak sah atau telah ditutup.'},401);
   const admins=await db('admin_users?username=eq.'+encodeURIComponent(config.actor)+'&is_active=eq.true&select=username,role,auth_user_id&limit=1');
   const admin=admins[0];if(!admin||admin.role!=='staff'||admin.auth_user_id)return reply({ok:false,error:'Akses PC produksi telah ditutup.'},403);
   const permissions=await db('admin_permissions?username=eq.'+encodeURIComponent(admin.username)+'&select=permissions&limit=1');
   if(!['view_orders','edit_order'].every(p=>(permissions[0]?.permissions||[]).includes(p)))return reply({ok:false,error:'Akses PC produksi telah ditutup.'},403);
   // Bounded JSON only; this capability cannot upload, comment, manage keys,
   // use Task Workspace, or change unrelated review/status values.
   if(!req.headers.get('content-type')?.startsWith('application/json'))return reply({ok:false,error:'JSON_REQUIRED'},415);
   const reader=req.body?.getReader();if(!reader)return reply({ok:false,error:'INVALID_REQUEST'},400);
   let bytes=0,text='';const decoder=new TextDecoder();
   while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>8192){await reader.cancel();return reply({ok:false,error:'REQUEST_TOO_LARGE'},413);}text+=decoder.decode(chunk.value,{stream:true});}
   let input;try{input=JSON.parse(text+decoder.decode());}catch{return reply({ok:false,error:'INVALID_REQUEST'},400);}
   if(!input||!['options','field','status','receipt'].includes(input.action)||!/^[-a-zA-Z0-9_]{1,80}$/.test(input.task_id||''))return reply({ok:false,error:'INVALID_ACTION'},400);
   const actor={username:admin.username,role:'staff',permissions:['view_orders','edit_order']};
   const handler=clickup({url,key,fetcher,trustedActor:actor});
   const invoke=(body:unknown)=>handler(new Request(req.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
   // A receipt is already actor+request+task scoped by the existing handler.
   // It must remain readable after Complete removes the task from this list.
   if(input.action!=='receipt'){
    const snapshot=await db('rpc/icetak_acrylic_production_snapshot',{});
    if(!(snapshot.rows||[]).some((row:SourceRow)=>row.task_id===input.task_id&&productionItem(row)))return reply({ok:false,error:'Task ini tidak lagi aktif dalam senarai Acrylic / Artpaper. Refresh semula.'},409);
   }
   if(input.action==='status'&&input.status?.toLowerCase()!=='complete')return reply({ok:false,error:'INVALID_STATUS'},400);
   if(input.action==='field'){
    const optionsResponse=await invoke({action:'options',task_id:input.task_id});
    const options=await optionsResponse.json();if(!optionsResponse.ok||!options.ok)return reply(options,optionsResponse.status);
    const review=options.review;
    if(!review?.available||input.field_id!==review.id||!review.options?.some((o:{id:string;name:string})=>o.id===input.value&&labels.has(o.name)))return reply({ok:false,error:'Hanya tindakan Printed atau AWB/address printed dibenarkan.'},400);
   }
   const r=await invoke(input),data=await r.json();
   if(input.action==='options'&&r.ok&&data.ok){
    const {ok,configured,can_edit,status,updated_at,statuses,review}=data;
    return reply({ok,configured,can_manage:false,can_edit,status,updated_at,statuses,review});
   }
   return reply(data,r.status);
  }catch{return reply({ok:false,error:'Sambungan PC produksi terganggu. Cuba semula.'},503);}
 };
}

