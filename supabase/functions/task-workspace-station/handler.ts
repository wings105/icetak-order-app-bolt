import {createTaskWorkspaceHandler} from '../task-workspace/handler.ts';
import {createTaskClickUpHandler} from '../task-clickup/handler.ts';
type Actor={username:string;role:string;permissions:string[]};
type Factory=(options:{url:string;key:string;fetcher?:typeof fetch;trustedActor:Actor})=>(req:Request)=>Promise<Response>;
const actions={workspace:new Set(['list','detail','save','upload','brief_save','asset','handoff']),clickup:new Set(['options','attachments','asset','status','field','comment','direct_upload','receipt'])};
const cors={'access-control-allow-origin':'https://shop.decocake.my','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,content-type,x-task-service','vary':'Origin'};
const result=(error:string,status:number)=>Response.json({ok:false,error},{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function stationDigest(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function createTaskStationHandler({url,key,fetcher=fetch,workspace=createTaskWorkspaceHandler,clickup=createTaskClickUpHandler}:{url:string;key:string;fetcher?:typeof fetch;workspace?:Factory;clickup?:Factory}){
 const headers={apikey:key,authorization:`Bearer ${key}`};
 async function read(path:string){const r=await fetcher(url+'/rest/v1/'+path,{headers,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('STATION_UNAVAILABLE');return r.json();}
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return result('POST_REQUIRED',405);
  const origin=req.headers.get('origin');if(origin&&origin!=='https://shop.decocake.my')return result('ORIGIN_NOT_ALLOWED',403);
  const token=req.headers.get('authorization')?.match(/^Bearer (tw_[a-f0-9]{64})$/)?.[1];
  if(!token)return result('Pautan Task Workspace tidak sah atau sudah ditutup.',401);
  try{
   const rows=await read('private_runtime_settings?setting_key=eq.task_workspace_station&select=setting_value&limit=1');
   let station;try{station=JSON.parse(rows[0]?.setting_value||'null');}catch{return result('STATION_UNAVAILABLE',503);}
   if(!station?.enabled||station.digest!==await stationDigest(token)||!/^task_station_[a-f0-9]{8}$/.test(station.actor||''))return result('Pautan Task Workspace tidak sah atau sudah ditutup.',401);
   const admins=await read('admin_users?username=eq.'+encodeURIComponent(station.actor)+'&is_active=eq.true&select=username,role,auth_user_id&limit=1');
   const admin=admins[0];if(!admin||admin.role!=='staff'||admin.auth_user_id)return result('STATION_DISABLED',403);
   const permissions=await read('admin_permissions?username=eq.'+encodeURIComponent(admin.username)+'&select=permissions&limit=1');
   const allowed=(permissions[0]?.permissions||[]).filter((p:string)=>['view_orders','edit_order'].includes(p));
   if(!allowed.includes('view_orders')||!allowed.includes('edit_order'))return result('STATION_DISABLED',403);
   const target=req.headers.get('x-task-service');if(target!=='workspace'&&target!=='clickup')return result('INVALID_SERVICE',400);
   const max=16*1024*1024;if(Number(req.headers.get('content-length'))>max)return result('REQUEST_TOO_LARGE',413);
   const reader=req.body?.getReader();if(!reader)return result('INVALID_REQUEST',400);
   let length=0;const chunks:Uint8Array[]=[];
   while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();return result('REQUEST_TOO_LARGE',413);}chunks.push(value);}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const forwarded=new Request(req.url,{method:'POST',headers:{'content-type':req.headers.get('content-type')||'application/json'},body:bytes});
   let input;try{input=(req.headers.get('content-type')||'').startsWith('multipart/form-data')?JSON.parse(String((await forwarded.clone().formData()).get('payload')||'{}')):await forwarded.clone().json();}catch{return result('INVALID_REQUEST',400);}
   if(!actions[target].has(input.action||'list'))return result('INVALID_ACTION',400);
   // Only the station gateway may inject this actor, after the revocable link
   // and active device identity have been checked. Browser input cannot set it.
   const handler=(target==='workspace'?workspace:clickup)({url,key,fetcher,trustedActor:{username:admin.username,role:'staff',permissions:allowed}});
   const response=await handler(forwarded),responseHeaders=new Headers(response.headers);
   for(const [name,value] of Object.entries(cors))responseHeaders.set(name,value);
   responseHeaders.set('cache-control','no-store');responseHeaders.set('referrer-policy','no-referrer');
   return new Response(response.body,{status:response.status,headers:responseHeaders});
  }catch{return result('Task Workspace belum dapat dihubungi. Cuba Refresh semula.',503);}
 };
}
