import {safeActionWebhookUrl} from '../_shared/awb-action-url.ts';
export const ACTION_SETTING='awb_preview_action_webhook_url';
type Grant={order_id:string;task_ids:string[];version:string;expires:number};
const encode=(value:Uint8Array)=>btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=(value:string)=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function signingKey(secret:string){return crypto.subtle.importKey('raw',new TextEncoder().encode(`awb-preview-actions-v1:${secret}`),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signActionGrant(secret:string,grant:Grant):Promise<string>{
 const bytes=new TextEncoder().encode(JSON.stringify(grant));
 return `${encode(bytes)}.${encode(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(secret),bytes)))}`;
}
export async function verifyActionGrant(secret:string,token:unknown,now=Date.now()):Promise<Grant|null>{
 try {
  if(typeof token!=='string'||token.length>32000)return null;
  const parts=token.split('.');if(parts.length!==2)return null;
  const bytes=decode(parts[0]);if(!await crypto.subtle.verify('HMAC',await signingKey(secret),decode(parts[1]),bytes))return null;
  const grant=JSON.parse(new TextDecoder().decode(bytes));
  return typeof grant.order_id==='string'&&Array.isArray(grant.task_ids)&&grant.task_ids.length<=200&&grant.task_ids.every((x:unknown)=>typeof x==='string')&&typeof grant.version==='string'&&Number.isFinite(grant.expires)&&grant.expires>now?grant:null;
 }catch{return null;}
}
export async function actionConfiguration(db:any){
 const {data,error}=await db.from('private_runtime_settings').select('setting_value,updated_at').eq('setting_key',ACTION_SETTING).maybeSingle();
 if(error)throw error;
 return {url:safeActionWebhookUrl(data?.setting_value),version:String(data?.updated_at||'')};
}
export async function actionAvailability(db:any,secret:string,orderId:string,taskIds:string[]){
 const config=await actionConfiguration(db);
 return {enabled:Boolean(config.url),token:config.url?await signActionGrant(secret,{order_id:orderId,task_ids:taskIds,version:config.version,expires:Date.now()+60*60*1000}):null};
}
export async function handleActionRequest(req:Request,db:any,secret:string,fetcher:typeof fetch=fetch):Promise<{body:Record<string,unknown>;status:number}>{
 const fail=(error:string,status=400,extra:Record<string,unknown>={})=>({body:{ok:false,error,...extra},status});
 if(Number(req.headers.get('content-length')||0)>40000)return fail('Request terlalu besar.',413);
 let body:any;try{const text=await req.text();if(text.length>40000)return fail('Request terlalu besar.',413);body=JSON.parse(text);}catch{return fail('JSON tidak sah.');}
 if(!body||typeof body!=='object')return fail('Request tidak sah.');
 if(![1,2,3].includes(body.buton)||typeof body.task_id_clickup!=='string'||!/^[-A-Za-z0-9]{3,80}$/.test(body.task_id_clickup)||typeof body.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))return fail('Butang atau task ID tidak sah.');
 const grant=await verifyActionGrant(secret,body.action_token);
 if(!grant||grant.order_id!==body.order_id||!grant.task_ids.includes(body.task_id_clickup))return fail('Sesi tindakan tamat atau task tidak sah. Tekan Refresh.',403);
 const config=await actionConfiguration(db);
 if(!config.url)return fail('Webhook belum diset. Isi URL di Settings Admin V2.',409);
 if(config.version!==grant.version)return fail('Tetapan webhook berubah. Tekan Refresh.',409);
 const {data:claim,error}=await db.rpc('claim_awb_preview_action',{p_request_id:body.request_id,p_order_reference:grant.order_id,p_task_id:body.task_id_clickup,p_buton:body.buton,p_config_version:config.version});
 if(error)throw error;
 if(claim.state==='sent')return {body:{ok:true,duplicate:true},status:200};
 if(claim.state==='pending')return fail('Penghantaran masih diproses. Cuba semula sebentar lagi.',409,{retryable:true});
 if(claim.state==='unknown')return fail('Status webhook belum dapat disahkan. Semak automation sebelum hantar semula.',409,{uncertain:true});
 if(claim.state!=='claimed')return fail(claim.error||'Tindakan tidak dibenarkan.',409);
 let state='unknown',httpStatus:number|null=null;
 try {
  const response=await fetcher(config.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','idempotency-key':body.request_id},body:JSON.stringify({buton:body.buton,task_id_clickup:body.task_id_clickup})});
  httpStatus=response.status;state=response.ok?'sent':'failed';await response.body?.cancel().catch(()=>{});
 }catch{/* A timeout may follow receipt: never automatically resend an ambiguous request. */}
 const {error:finishError}=await db.rpc('finish_awb_preview_action',{p_request_id:body.request_id,p_state:state,p_http_status:httpStatus});
 if(finishError)throw finishError;
 if(state==='sent')return {body:{ok:true},status:200};
 return state==='failed'?fail('Webhook menolak penghantaran. Cuba semula.',502,{retryable:true}):fail('Status webhook belum dapat disahkan. Semak automation sebelum hantar semula.',502,{uncertain:true});
}
