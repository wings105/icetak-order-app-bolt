import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
type Obj=Record<string,any>;
const BASE=Deno.env.get('SUPABASE_URL')||'',KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
async function db(path:string,body?:Obj){const r=await fetch(BASE+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:KEY,authorization:'Bearer '+KEY,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('DB_'+r.status);return r.json();}
async function setting(k:string){return (await db('private_runtime_settings?setting_key=eq.'+k+'&select=setting_value&limit=1'))[0]?.setting_value||'';}
async function sha(v:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].join(',');}
const FIELD_NAMES:Obj={'01cec4ef-a30b-443d-a43a-9ab09835b78c':'Review customer','4cdb78bd-4fc4-4fd6-a1dd-5b6b01ea4110':'designflow'};
export function selected(field:Obj,option:Obj){return field?.value!==undefined&&field?.value!==null&&(String(field.value)===option.id||(Number.isInteger(option.orderindex)&&String(field.value)===String(option.orderindex))); }
export async function sync(job:Obj,token:string){
 const rpc=(action:string,data:Obj={})=>db('rpc/icetak_designflow_sync',{p_action:action,p_task:job.task_id,p_field:job.field_id,p_revision:job.revision,p_lease:job.lease,p_data:data});
 const api=async(path:string,body?:Obj)=>{const r=await fetch('https://api.clickup.com/api/v2/'+path,{method:body?'POST':'GET',headers:{authorization:token,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('CLICKUP_'+r.status);return r.json();};
 try{
  if(!(await rpc('check')).valid)return rpc('ack',{ok:false,error:'SOURCE_SUPERSEDED'});
  const task=await api('task/'+encodeURIComponent(job.task_id));
  if(String(task.list?.id)!=='18375902'||!/^(?:design editing\s*-\s*topper|cake topper\s*-\s*printing)$/i.test(task.status?.status||'')||(task.tags||[]).some((t:Obj)=>/cancel/i.test(t.name)))throw Error('TASK_NOT_IN_ACTIVE_TOPPER_FLOW');
  if(!(task.attachments||[]).some((a:Obj)=>a.id===job.source?.attachment_id))throw Error('RENDER_ATTACHMENT_MISSING');
  const defs=await api('list/18375902/field');const field=defs.fields?.find((f:Obj)=>f.id===job.field_id&&f.type==='drop_down'&&f.name===FIELD_NAMES[job.field_id]);
  const option=field?.type_config?.options?.find((o:Obj)=>o.id===job.option_id&&o.name===job.option_name);if(!option)throw Error('FIELD_OPTION_CHANGED');
  const current=(task.custom_fields||[]).find((f:Obj)=>f.id===job.field_id);
  if(!selected(current,option)){
   if(!(await rpc('check')).valid)return rpc('ack',{ok:false,error:'SOURCE_SUPERSEDED'});
   await api('task/'+encodeURIComponent(job.task_id)+'/field/'+job.field_id,{value:job.option_id});
  }
  const proof=await api('task/'+encodeURIComponent(job.task_id));
  if(!selected(proof.custom_fields?.find((f:Obj)=>f.id===job.field_id),option))throw Error('FIELD_READBACK_PENDING');
  return rpc('ack',{ok:true});
 }catch(e){return rpc('ack',{ok:false,error:String(e instanceof Error?e.message:e).replace(/[^A-Z0-9_ -]/gi,'').slice(0,160)});}
}
Deno.serve(async req=>{const out=(v:Obj,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});if(req.method==='GET')return out({service:'clickup-designflow-sync'});if(req.method!=='POST')return out({error:'METHOD_NOT_ALLOWED'},405);
 try{const expected=await setting('order_brief_worker_token');if(!expected||await sha(expected)!==await sha(req.headers.get('x-order-brief-token')||''))return out({error:'UNAUTHORIZED'},401);const b=await req.json();if(b.action!=='run')return out({error:'INVALID_ACTION'},400);const token=await setting('clickup_designer_api_token');if(!token)return out({error:'CLICKUP_NOT_CONFIGURED'},503);
 const results=[];for(let i=0;i<2;i++){const j=await db('rpc/icetak_designflow_sync',{p_action:'claim'});if(!j)break;results.push(await sync(j,token));}return out({ok:true,results});
 }catch{return out({error:'FIELD_SYNC_FAILED'},502);}
});
