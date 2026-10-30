export type Run={id:string;action:string;conversation_id:string;provider_message_id:string;message_id:string;message_at:string;phone?:string;bsuid?:string;rule_snapshot:{config?:{image_url?:string;caption?:string}}};
type Deps={url:string;token:string;fetcher:typeof fetch};
export async function executeRun(run:Run,{url,token,fetcher}:Deps){
 const call=async(endpoint:string,body:unknown,authHeader='x-order-draft-token')=>{
  const r=await fetcher(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',[authHeader]:token,...(authHeader==='x-icetak-key'?{'x-client-id':'icetak-automation'}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(65000)});
  const data=await r.json().catch(()=>({}));return {r,data};
 };
 let sending=false;
 try{
  if(['draft_prepaid','draft_pickup'].includes(run.action)){
   const pickup=run.action==='draft_pickup';
   const {r,data}=await call(`${url}/functions/v1/order-draft-trigger`,{
    conversation_id:run.conversation_id,phone:run.phone,bsuid:run.bsuid,
    provider_message_id:run.provider_message_id,trigger_message_id:run.message_id,cutoff_at:run.message_at,
    source_type:pickup?'pickup_trigger':'chat_trigger',payment_mode:pickup?'cash_counter':'prepaid',
    request_key:`wa:${pickup?'pickup':'prepaid'}:${run.provider_message_id}`,
   });
   const draftId=data.result?.id||data.result?.draft_id;
   if(r.ok&&data.ok===true&&draftId)return {status:'succeeded',result:{draft_id:draftId,duplicate:data.result?.duplicate===true,payment_mode:pickup?'cash_counter':'prepaid',notification_sent:data.result?.notification?.sent===true}};
   const error=String(data.error||`DRAFT_HTTP_${r.status}`).slice(0,240);
   return {status:r.status>=500?'retry':'blocked',reason:error,result:{http_status:r.status}};
  }
  if(run.action!=='send_qr')return {status:'blocked',reason:'UNSUPPORTED_ACTION'};
  const config=run.rule_snapshot.config||{};
  if(!config.image_url||!/^https:\/\//.test(config.image_url))return {status:'blocked',reason:'QR_IMAGE_REQUIRED'};
  const policy=await call('https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/automation-order-policy',{conversation_id:run.conversation_id},'x-automation-token');
  if(!policy.r.ok||policy.data.can_send!==true)return {status:'blocked',reason:String(policy.data.reason||'SEND_POLICY_UNAVAILABLE')};
  // Existing sender owns recipient resolution, 24-hour gate, request receipt and Inbox mirroring.
  sending=true;
  const {r,data}=await call(`${url}/functions/v1/external-whatsapp-send`,{request_id:`wa-auto:${run.id}`,phone:run.phone,bsuid:run.bsuid,type:'image',url_image:config.image_url,caption:config.caption||''},'x-icetak-key');
  if(data.ok===true&&data.provider_message_id)return {status:'succeeded',result:{provider_message_id:data.provider_message_id,delivery:'accepted',sender_request_id:`wa-auto:${run.id}`,duplicate:data.duplicate===true}};
  if(data.duplicate&&data.status==='processing')return {status:'uncertain',reason:'SENDER_STILL_PROCESSING'};
  return {status:r.status>=500?'uncertain':'blocked',reason:String(data.error_code||data.error||'QR_NOT_ACCEPTED').slice(0,240),result:{sender_request_id:`wa-auto:${run.id}`,http_status:r.status}};
 }catch{
  return {status:sending?'uncertain':run.action==='send_qr'?'blocked':'retry',reason:sending?'PROVIDER_OUTCOME_UNKNOWN':'REQUEST_FAILED'};
 }
}
