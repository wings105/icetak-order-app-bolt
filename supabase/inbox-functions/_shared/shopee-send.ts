import {providerResult} from './shopee-provider-result.ts';
const text=(v:unknown)=>String(v??'').trim();
const out=(body:unknown,status=200)=>Response.json(body,{status});
export async function sendShopee(db:any,body:Record<string,any>,actor:{id:string|null,label:string}) {
 const content=text(body.text),requestId=text(body.request_id);
 if(!content||content.length>4000||!/^[0-9a-f-]{36}$/i.test(requestId)) return out({ok:false,error:'Mesej dan request ID yang sah diperlukan.'},400);
 let conversation:any=null,order:any=null;
 if(body.conversation_id){const r=await db.from('conversations').select('*').eq('id',body.conversation_id).single();if(r.error||r.data?.channel!=='shopee')return out({ok:false,error:'Conversation Shopee diperlukan.'},422);conversation=r.data;}
 if(body.order_summary_id||body.order_no){let q=db.from('external_order_summaries').select('*').eq('source_channel','shopee');q=body.order_summary_id?q.eq('id',body.order_summary_id):q.eq('order_no',body.order_no);const r=await q.maybeSingle();if(r.error)return out({ok:false,error:'Order tidak dapat disahkan.'},422);order=r.data;}
 if(order&&conversation&&(String(conversation.external_customer_id)!==String(order.shopee_buyer_id)||String(conversation.metadata?.shop_id)!==String(order.shop_id))) return out({ok:false,error:'Buyer atau shop order tidak sepadan dengan chat.'},409);
 if(!conversation&&order){const {data}=await db.from('conversations').select('*').eq('channel','shopee').eq('external_customer_id',String(order.shopee_buyer_id)).contains('metadata',{shop_id:String(order.shop_id)}).order('last_message_at',{ascending:false}).limit(1);conversation=data?.[0];}
 if(!conversation) return out({ok:false,error:'Conversation Shopee belum tersedia. Buka chat customer yang dipautkan dahulu.'},422);
 if(body.revision&&body.revision!==conversation.last_message_at) return out({ok:false,error:'Chat sudah berubah. Semak mesej terbaru dahulu.'},409);
 const buyer=text(conversation.external_customer_id),shop=text(conversation.metadata?.shop_id);
 if(!buyer||!shop)return out({ok:false,error:'Identiti buyer dan shop belum disahkan.'},422);
 const {data:settingRows,error:settingError}=await db.from('private_runtime_settings').select('setting_key,setting_value').in('setting_key',['shopee_chat_send_endpoint','shopee_chat_send_token']);
 if(settingError)return out({ok:false,error:'Konfigurasi Shopee tidak tersedia.'},503);
 const settings=Object.fromEntries((settingRows||[]).map((s:any)=>[s.setting_key,s.setting_value]));
 const endpoint=text(settings.shopee_chat_send_endpoint),token=text(settings.shopee_chat_send_token);
 // Do not create a pending message when the provider is not connected.
 if(!endpoint||!token)return out({ok:false,error:'Shopee Chat belum disambung. Draf kekal di sini; mesej belum dihantar.',code:'SHOPEE_CHAT_NOT_CONFIGURED'},503);
 if(!endpoint.startsWith('https://'))return out({ok:false,error:'Endpoint Shopee mesti HTTPS.'},503);
 const {data:claim,error:claimError}=await db.rpc('claim_shopee_send',{p_request_id:requestId,p_conversation_id:conversation.id,p_order_summary_id:order?.id||null,p_order_no:order?.order_no||null,p_staff_user_id:actor.id,p_actor_label:actor.label,p_text:content,p_buyer_id:buyer});
 if(claimError)return out({ok:false,error:'Rekod penghantaran tidak dapat disediakan.'},409);
 const attempt=claim.attempt;
 if(!claim.claimed)return out({ok:attempt.status==='sent',duplicate:true,status:attempt.status,local_message_id:attempt.local_message_id,provider_message_id:attempt.provider_message_id,error:attempt.status==='sent'?null:'Permintaan ini sudah direkod. Semak status sebelum menghantar semula.'},attempt.status==='sent'?200:409);
 let result:{status:string,id:string,error:string|null};let httpStatus:number|null=null;
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'x-icetak-token':token,'Idempotency-Key':requestId},body:JSON.stringify({action:'send_message',provider:'shopee',request_id:requestId,conversation_id:conversation.id,provider_conversation_id:conversation.external_conversation_id,shop_id:shop,buyer_user_id:buyer,buyer_shop_id:conversation.metadata?.buyer_shop_id,order_sn:order?.order_no||null,message_type:'text',text:content}),signal:AbortSignal.timeout(20000)});
  httpStatus=response.status;result=providerResult(response.status,await response.json().catch(()=>({})));
 }catch{result={status:'unknown',id:'',error:'Status tidak pasti. Semak Shopee asal sebelum cuba semula.'};}
 const now=new Date().toISOString();
 const {error:messageError}=await db.from('messages').update({status:result.status,provider_message_id:result.id||null,sent_at:result.status==='sent'?now:null,failed_at:result.status==='failed'?now:null,failure_reason:result.error,updated_at:now}).eq('id',attempt.local_message_id);
 const {error:auditError}=await db.from('shopee_chat_send_attempts').update({status:result.status,upstream_status:httpStatus,provider_message_id:result.id||null,error_message:result.error,completed_at:now}).eq('id',attempt.id);
 if(result.status==='sent'){
  await db.from('conversations').update({last_outbound_at:now,last_message_at:now,last_message_sender:'seller'}).eq('id',conversation.id);
  await db.from('conversation_activity_logs').insert({conversation_id:conversation.id,event_type:'shopee_message_sent',actor_type:'staff',actor_id:actor.id,actor_label:actor.label,source:'shopee-chat-send',summary:'Mesej Shopee dihantar dari iCetak',metadata:{request_id:requestId,provider_message_id:result.id},importance:'normal'});
 }
 return out({ok:result.status==='sent',status:result.status,local_message_id:attempt.local_message_id,provider_message_id:result.id||null,error:result.error,...(messageError||auditError?{warning:'Status provider diterima; rekod Inbox perlu disemak.'}:{})},result.status==='sent'?200:502);
}
