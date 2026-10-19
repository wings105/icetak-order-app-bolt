import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {previewItem} from '../awb-preview/preview.ts';
import {loadReadiness} from './sources.ts';
import {taskReadiness,validateBrief,briefFingerprint} from './readiness.ts';
const base=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={apikey:key,authorization:`Bearer ${key}`};
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(data:unknown,status=200)=>Response.json(data,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function call(path:string,init:RequestInit={}){
 const r=await fetch(base+path,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(25000)});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.message||data.error||'REQUEST_FAILED');return data;
}
const rpc=(name:string,body:unknown)=>call('/rest/v1/rpc/'+name,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const validTask=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
function fileType(bytes:Uint8Array){
 if(bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47)return 'image/png';
 if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'image/jpeg';
 const text=new TextDecoder().decode(bytes.slice(0,12));
 if(text.startsWith('RIFF')&&text.slice(8)==='WEBP')return 'image/webp';
 if(text.startsWith('%PDF-'))return 'application/pdf';return '';
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 let uploaded='',commitStarted=false;
 try{
  const authorization=req.headers.get('authorization');if(!authorization)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,authorization},signal:AbortSignal.timeout(10000)});
  const user=await auth.json().catch(()=>null);if(!auth.ok||!user?.id)return out({ok:false,error:'LOGIN_REQUIRED'},401);
  const admins=await call(`/rest/v1/admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
  const admin=admins[0];if(!admin)return out({ok:false,error:'ADMIN_REQUIRED'},403);
  const perms=await call(`/rest/v1/admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);
  const permissions=perms[0]?.permissions||[];
  const canEdit=admin.role==='owner'||permissions.some((p:string)=>['edit_order','approve_production','manage_admins'].includes(p));
  const canConfirm=admin.role==='owner'||permissions.some((p:string)=>['edit_order','manage_customers','manage_admins'].includes(p));
  if(!canEdit&&!permissions.includes('view_orders'))return out({ok:false,error:'TASK_ACCESS_REQUIRED'},403);
  const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
  const body=multipart?await req.formData():await req.json();
  const input=multipart?JSON.parse(String(body.get('payload')||'{}')):body;
  const action=input.action||'list';
  if(!['list','detail','save','upload','brief_save'].includes(action))return out({ok:false,error:'INVALID_ACTION'},400);
  if(action!=='list'&&!validTask(input.task_id))return out({ok:false,error:'INVALID_TASK'},400);
  if(action==='brief_save'){
   if(!canConfirm)return out({ok:false,error:'Pengesahan brief memerlukan kebenaran admin.'},403);
   if(!Number.isInteger(input.version)||input.version<0||!/^[-a-f0-9]{36}$/i.test(input.request_id||'')||!/^[a-f0-9]{64}$/.test(input.fingerprint||''))return out({ok:false,error:'INVALID_BRIEF_VERSION'},400);
   const payload={version:input.version,fingerprint:input.fingerprint,confirm:input.confirm===true,brief:input.brief};
   const previous=await call(`/rest/v1/task_workspace_brief_events?request_id=eq.${input.request_id}&select=task_id,actor,input,result&limit=1`);
   if(previous[0]){const p=previous[0];if(p.task_id!==input.task_id||p.actor!==admin.username||await briefFingerprint(p.input)!==await briefFingerprint(payload))return out({ok:false,error:'REQUEST_CONFLICT'},409);return out(p.result);}
   const data=await rpc('icetak_task_workspace_read',{p_task_id:input.task_id});
   if(!data.items?.length)return out({ok:false,error:'Task tidak lagi tersedia.'},409);
   const source=(await loadReadiness(data.items,rpc,call))[input.task_id];
   if(source.readiness.fingerprint!==input.fingerprint)return out({ok:false,error:'Sumber / chat berubah. Refresh dan semak semula sebelum sahkan.'},409);
   const brief=validateBrief(input.brief);
   if(brief.values.artwork?.startsWith('task-file://')&&!source.source.files.some((f:any)=>f.id===brief.values.artwork.slice(12)&&f.mime.startsWith('image/')))return out({ok:false,error:'Gambar mesti milik task ini.'},400);
   if(brief.values.artwork?.startsWith('wasapflow-media://')&&brief.values.artwork!==source.readiness.values.artwork)return out({ok:false,error:'Pilih media sah yang sudah dipadankan dengan task ini.'},400);
   if(brief.final_file_id&&!source.source.files.some((f:any)=>f.id===brief.final_file_id))return out({ok:false,error:'Fail final mesti milik task ini.'},400);
   const checked=await taskReadiness(source.source,source.order,source.context,source.saved,brief);
   if(input.confirm===true&&!checked.can_confirm)return out({ok:false,error:'Lengkapkan detail wajib dan semak sumber sebelum sahkan.'},400);
   return out(await rpc('icetak_task_brief_save',{p_actor:admin.username,p_request:input.request_id,p_task_id:input.task_id,p_version:input.version,
    p_source_token:source.source.source_token,p_source_fingerprint:input.fingerprint,p_data:brief,p_confirmed:input.confirm===true,p_input:payload}));
  }
  if(action==='save'||action==='upload'){
   if(!canEdit)return out({ok:false,error:'WORK_PERMISSION_REQUIRED'},403);
   if(!Number.isInteger(input.version)||input.version<0||!input.source_updated_at||!/^[-a-f0-9]{36}$/i.test(input.request_id||''))return out({ok:false,error:'INVALID_VERSION'},400);
   let patch=input.patch;
   if(action==='upload'){
    const file=multipart?body.get('file'):null;
    if(!(file instanceof File)||file.size<=0||file.size>15728640)return out({ok:false,error:'Fail mestilah PNG, JPG, WebP atau PDF, maksimum 15 MB.'},400);
    // Check current membership/version before accepting any bytes into storage.
    const current=await rpc('icetak_task_workspace_read',{p_task_id:input.task_id});
    const task=current.items?.[0];if(!task||task.version!==input.version||task.source_updated_at!==input.source_updated_at)return out({ok:false,error:'Task berubah. Refresh sebelum upload.'},409);
    const bytes=new Uint8Array(await file.arrayBuffer()),mime=fileType(bytes);
    if(!mime)return out({ok:false,error:'Format fail tidak disokong.'},400);
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','application/pdf':'pdf'}[mime];
    uploaded=`${input.task_id}/${crypto.randomUUID()}.${extension}`;
    await call('/storage/v1/object/task-workspace/'+uploaded,{method:'POST',headers:{'content-type':mime,'x-upsert':'false'},body:bytes});
    patch={file:{path:uploaded,name:file.name,mime}};
   }else if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['stage','assignee','note'].includes(k))){return out({ok:false,error:'INVALID_PATCH'},400);}
   commitStarted=true;
   const result=await rpc('icetak_task_workspace_save',{p_actor:admin.username,p_request:input.request_id,p_task_id:input.task_id,p_version:input.version,p_source_revision:input.source_updated_at,p_patch:patch});
   uploaded='';return out(result);
  }
  const data=await rpc('icetak_task_workspace_read',{p_task_id:action==='detail'?input.task_id:null});
  const readiness=await loadReadiness(data.items||[],rpc,call);
  const items=await Promise.all((data.items||[]).map(async(row:any)=>{
   const images=previewItem(row).images;
   const files=await Promise.all((row.files||[]).map(async(file:any)=>{
    const signed=await call('/storage/v1/object/sign/task-workspace/'+file.storage_path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expiresIn:900})});
    return {id:file.id,name:file.name,mime:file.mime,uploaded_by:file.uploaded_by,created_at:file.created_at,url:base+'/storage/v1'+signed.signedURL};
   }));
   const {attachments,comment_images,...item}=row;
   const brief=readiness[row.task_id].readiness;
   if(brief.values.artwork?.startsWith('task-file://'))brief.artwork_url=files.find((f:any)=>f.id===brief.values.artwork.slice(12))?.url||null;
   // Whole conversations stay in Inbox; task users receive only extracted evidence for this brief.
   if(action==='list'){brief.evidence=[];brief.conflicts=[];}
   return {...item,images,files,readiness:brief};
  }));
  return out({ok:true,...data,items,can_edit:canEdit,can_confirm:canConfirm,actor:admin.username,read_at:new Date().toISOString()});
 }catch(e){
  const message=e instanceof Error?e.message:'';
  // A transport timeout may follow a committed database write: never delete its file.
  if(uploaded&&(!commitStarted||/CONFLICT|SOURCE_CHANGED|TASK_NOT_ACTIVE|INVALID_/.test(message)))await call('/storage/v1/object/task-workspace',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefixes:[uploaded]})}).catch(()=>{});
  if(/CONFLICT|SOURCE_CHANGED|TASK_NOT_ACTIVE/.test(message))return out({ok:false,error:'Task sudah berubah. Refresh dan semak semula sebelum simpan.'},409);
  if(/INVALID_/.test(message))return out({ok:false,error:'Detail brief tidak sah. Semak medan dan URL gambar.'},400);
  return out({ok:false,error:'Operasi task gagal. Cuba semula.'},503);
 }
});
