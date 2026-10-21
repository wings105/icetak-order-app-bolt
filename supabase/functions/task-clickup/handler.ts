type Data=Record<string,any>;
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const response=(body:Data,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
const validTask=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
const validId=(v:unknown)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const errorText:Record<string,string>={CLICKUP_NOT_CONNECTED:'API ClickUp belum disambungkan. Owner boleh sambungkan dalam Settings.',TASK_CHANGED:'Status task berubah. Semak status terkini sebelum cuba lagi.',TASK_NOT_ACTIVE:'Task ini tidak lagi aktif dalam ORDER LIST.',WORK_PERMISSION_REQUIRED:'Kebenaran designer diperlukan.',INVALID_TASK_FILE:'Fail mesti milik task ini.',TASK_ACTION_BUSY:'Ada tindakan task sedang diproses. Semak semula sebentar lagi.',REQUEST_CONFLICT:'Rujukan penghantaran digunakan untuk data berbeza.',DUPLICATE_ACTION:'Hasil yang sama sudah pernah dihantar atau sedang diproses. Semak rekod penghantaran.',DELIVERY_UNKNOWN:'Penghantaran belum dapat disahkan. Guna Semak penghantaran sebelum cuba hantar semula.'};
async function fingerprint(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function createTaskClickUpHandler({url,key,fetcher=fetch}:{url:string;key:string;fetcher?:typeof fetch}){
 const service={apikey:key,authorization:`Bearer ${key}`};
 async function db(path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  const r=await fetcher(url+'/rest/v1/'+path,{method,headers:{...service,'content-type':'application/json',prefer:'return=representation'+(path.includes('on_conflict=')?',resolution=merge-duplicates':'')},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.message||'DATABASE_FAILED');return data;
 }
 const rpc=(name:string,body:Data)=>db('rpc/'+name,body);
 async function provider(token:string,path:string,body?:unknown,method=body===undefined?'GET':'POST'){
  const multipart=body instanceof FormData;
  const r=await fetcher('https://api.clickup.com/api/v2/'+path,{method,headers:{authorization:token,...(!multipart?{'content-type':'application/json'}:{})},...(body===undefined?{}:{body:multipart?body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(25000)});
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(r.status>=500?'PROVIDER_UNCERTAIN':'CLICKUP_REJECTED_'+r.status);
  if(!data||data.err||data.error)throw Error('PROVIDER_UNCERTAIN');return data;
 }
 async function setting(){const data=await db('private_runtime_settings?setting_key=eq.clickup_designer_api_token&select=setting_value&limit=1');return data[0]?.setting_value||'';}
 async function patch(id:string,values:Data){await db('task_clickup_actions?request_id=eq.'+id,{...values,updated_at:new Date().toISOString()},'PATCH');}
 async function liveTask(token:string,id:string){const task=await provider(token,'task/'+encodeURIComponent(id));if(task.id!==id||String(task.list?.id)!=='18375902'||task.archived)throw Error('TASK_NOT_ACTIVE');return task;}
 async function project(task:Data){await rpc('icetak_project_clickup_work',{p_task:task,p_observed_at:new Date().toISOString()});}
 async function verifyComment(token:string,id:string,commentId:string,marker:string){
  const data=await provider(token,'task/'+encodeURIComponent(id)+'/comment');
  return (data.comments||[]).find((c:Data)=>(!commentId||String(c.id)===commentId)&&String(c.comment_text||JSON.stringify(c.comment||[])).includes(marker));
 }
 return async(req:Request)=>{
  if(req.method==='OPTIONS')return response({ok:true});if(req.method!=='POST')return response({ok:false,error:'POST_REQUIRED'},405);
  let actionId='',dispatched=false,step='claimed',attachment:Data|null=null;
  try{
   const authorization=req.headers.get('authorization');if(!authorization)return response({ok:false,error:'LOGIN_REQUIRED'},401);
   const auth=await fetcher(url+'/auth/v1/user',{headers:{apikey:key,authorization},signal:AbortSignal.timeout(10000)});const user=await auth.json().catch(()=>null);if(!auth.ok||!user?.id)return response({ok:false,error:'LOGIN_REQUIRED'},401);
   const admins=await db('admin_users?auth_user_id=eq.'+encodeURIComponent(user.id)+'&is_active=eq.true&select=username,role&limit=1');const admin=admins[0];if(!admin)return response({ok:false,error:'ADMIN_REQUIRED'},403);
   const perms=await db('admin_permissions?username=eq.'+encodeURIComponent(admin.username)+'&select=permissions&limit=1');const permissions=perms[0]?.permissions||[];
   const manage=admin.role==='owner'||permissions.includes('manage_admins'),edit=admin.role==='owner'||permissions.some((p:string)=>['edit_order','approve_production','manage_admins'].includes(p));
   if(!edit&&!permissions.includes('view_orders'))return response({ok:false,error:'TASK_ACCESS_REQUIRED'},403);
   const b=await req.json(),action=b.action;let token=await setting();
   if(action==='connection')return response({ok:true,configured:!!token,can_manage:manage,can_edit:edit,statuses:[]});
   if(action==='connect'){
    if(!manage)return response({ok:false,error:'OWNER_REQUIRED'},403);
    if(typeof b.token!=='string'||b.token.trim().length<10||b.token.length>500||/[\r\n]/.test(b.token))return response({ok:false,error:'API token tidak sah.'},400);
    token=b.token.trim();const list=await provider(token,'list/18375902');if(String(list.id)!=='18375902'||!Array.isArray(list.statuses))throw Error('CLICKUP_ACCESS_REQUIRED');
    await db('private_runtime_settings?on_conflict=setting_key',[{setting_key:'clickup_designer_api_token',setting_value:token,updated_at:new Date().toISOString()},{setting_key:'clickup_designer_connection',setting_value:JSON.stringify({by:admin.username,at:new Date().toISOString(),list_id:'18375902'}),updated_at:new Date().toISOString()}],'POST');
    return response({ok:true,configured:true,can_manage:manage,can_edit:edit,statuses:[]});
   }
   if(!['options','status','comment','receipt'].includes(action)||!validTask(b.task_id))return response({ok:false,error:'INVALID_ACTION'},400);
   const snapshot=await rpc('icetak_task_workspace_read',{p_task_id:b.task_id});if(!snapshot.items?.length)throw Error('TASK_NOT_ACTIVE');
   const source=snapshot.items[0];
   if(action==='options'&&!token)return response({ok:true,configured:false,can_manage:manage,can_edit:edit,status:source.source_status,statuses:[]});
   if(!token)throw Error('CLICKUP_NOT_CONNECTED');
   if(action==='options'){
    const [task,list]=await Promise.all([liveTask(token,b.task_id),provider(token,'list/18375902')]);
    return response({ok:true,configured:true,can_manage:manage,can_edit:edit,status:task.status?.status,updated_at:String(task.date_updated),task_url:task.url,statuses:(list.statuses||[]).map((s:Data)=>({status:s.status,color:s.color}))});
   }
   if(!edit)return response({ok:false,error:errorText.WORK_PERMISSION_REQUIRED},403);
   if(!validId(b.request_id))return response({ok:false,error:'INVALID_REQUEST'},400);
   if(action==='receipt'){
    const rows=await db('task_clickup_actions?request_id=eq.'+b.request_id+'&task_id=eq.'+encodeURIComponent(b.task_id)+'&actor=eq.'+encodeURIComponent(admin.username)+'&limit=1');const receipt=rows[0];if(!receipt)return response({ok:false,error:'RECEIPT_NOT_FOUND'},404);
    if(receipt.state==='succeeded')return response({ok:true,...receipt.result});
    if(receipt.kind==='status'){const current=await liveTask(token,b.task_id);if(current.status?.status===receipt.payload.status){await project(current);const result={status:current.status.status,verified:true};await patch(b.request_id,{state:'succeeded',step:'verified',result});return response({ok:true,...result});}}
    else{const found=await verifyComment(token,b.task_id,'','[iCetak:'+b.request_id+']');if(found){const result={comment_id:String(found.id),verified:true,attachment:receipt.result.attachment||null};await patch(b.request_id,{state:'succeeded',step:'verified',result});return response({ok:true,...result});}}
    throw Error('DELIVERY_UNKNOWN');
   }
   if(action==='status'&&(typeof b.status!=='string'||b.status.length>100||typeof b.expected_status!=='string'||typeof b.expected_updated_at!=='string'))return response({ok:false,error:'INVALID_STATUS'},400);
   if(action==='comment'&&(typeof b.comment!=='string'||b.comment.length>5000||b.file_id&&!validId(b.file_id)||!b.comment.trim()&&!b.file_id))return response({ok:false,error:'INVALID_COMMENT'},400);
   const payload=action==='status'?{status:b.status,expected_status:b.expected_status,expected_updated_at:b.expected_updated_at}:{file_id:b.file_id||null,comment:b.comment.trim()};
   const claimed=await rpc('icetak_claim_task_clickup_action',{p_request:b.request_id,p_task:b.task_id,p_actor:admin.username,p_kind:action,p_fingerprint:await fingerprint(payload),p_payload:payload});
   if(!claimed.claimed){if(claimed.receipt.state==='succeeded')return response({ok:true,...claimed.receipt.result,replayed:true});throw Error('DELIVERY_UNKNOWN');}
   actionId=b.request_id;
   const task=await liveTask(token,b.task_id);
   if(action==='status'){
    const list=await provider(token,'list/18375902');if(!(list.statuses||[]).some((s:Data)=>s.status===b.status))throw Error('INVALID_STATUS');
    if(task.status?.status!==b.expected_status||String(task.date_updated)!==b.expected_updated_at)throw Error('TASK_CHANGED');
    step='status';await patch(actionId,{step});dispatched=true;await provider(token,'task/'+encodeURIComponent(b.task_id),{status:b.status},'PUT');
    const fresh=await liveTask(token,b.task_id);if(fresh.status?.status!==b.status)throw Error('PROVIDER_UNCERTAIN');await project(fresh);
    const result={status:fresh.status.status,updated_at:String(fresh.date_updated),verified:true};await patch(actionId,{state:'succeeded',step:'verified',result});return response({ok:true,...result});
   }
   if(b.file_id){
    const files=await db('task_workspace_files?id=eq.'+b.file_id+'&task_id=eq.'+encodeURIComponent(b.task_id)+'&limit=1');const file=files[0];if(!file)throw Error('INVALID_TASK_FILE');
    const original=await fetcher(url+'/storage/v1/object/task-workspace/'+file.storage_path,{headers:service,signal:AbortSignal.timeout(20000)});if(!original.ok)throw Error('FILE_READ_FAILED');
    const bytes=await original.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>15728640)throw Error('INVALID_TASK_FILE');
    const multipart=new FormData();multipart.set('attachment',new File([bytes],file.name,{type:file.mime}));
    step='attachment';await patch(actionId,{step});dispatched=true;attachment=await provider(token,'task/'+encodeURIComponent(b.task_id)+'/attachment',multipart);
    if(!attachment.id||!attachment.url||!/^https:\/\//.test(attachment.url))throw Error('PROVIDER_UNCERTAIN');
    await patch(actionId,{step:'attachment_saved',result:{attachment:{id:attachment.id,url:attachment.url}}});
   }
   const marker='[iCetak:'+actionId+']',text=[b.comment.trim(),attachment?'Fail design: '+attachment.url:'',marker].filter(Boolean).join('\n\n');
   step='comment';await patch(actionId,{step});dispatched=true;const posted=await provider(token,'task/'+encodeURIComponent(b.task_id)+'/comment',{comment_text:text,notify_all:false});if(!posted.id)throw Error('PROVIDER_UNCERTAIN');
   const confirmed=await verifyComment(token,b.task_id,String(posted.id),marker);if(!confirmed)throw Error('PROVIDER_UNCERTAIN');
   const result={comment_id:String(confirmed.id),attachment:attachment?{id:attachment.id,url:attachment.url}:null,verified:true};await patch(actionId,{state:'succeeded',step:'verified',result});return response({ok:true,...result});
  }catch(e){
   const message=e instanceof Error?e.message:'FAILED',knownRejection=message.startsWith('CLICKUP_REJECTED_');
   if(actionId)await patch(actionId,{state:dispatched&&!knownRejection?'unknown':'failed',step,...(attachment?{result:{attachment:{id:attachment.id,url:attachment.url}}}:{})}).catch(()=>{});
   const uncertain=dispatched&&!knownRejection;
   return response({ok:false,error:uncertain?errorText.DELIVERY_UNKNOWN:errorText[message]||(/^CLICKUP_REJECTED_/.test(message)?'ClickUp menolak permintaan. Semak akses API dan task.':'Tindakan ClickUp gagal. Semak sambungan dan cuba semula.'),...(actionId?{request_id:actionId,uncertain}:{})},/PERMISSION|OWNER|ACCESS_REQUIRED/.test(message)?403:/INVALID/.test(message)?400:/TASK_CHANGED|CONFLICT|DUPLICATE|BUSY|DELIVERY_UNKNOWN/.test(message)?409:503);
  }
 };
}
