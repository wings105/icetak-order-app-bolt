import {shopeeRequest} from './shopee-direct.ts';
const text=(value:unknown)=>String(value??'').trim();
export async function markShopeeRead(db:any,config:any,conversation:any,messageId:string,actor:any) {
 let confirmed=false,code=messageId?'READ_UNKNOWN':'READ_MESSAGE_MISSING';
 let unreadCount:number|null=null,lastReadMessageId:string|null=null;
 try {
  if(messageId){
   const response=await shopeeRequest(config,'/api/v2/sellerchat/read_conversation',{conversation_id:text(conversation.external_conversation_id),last_read_message_id:messageId,business_type:0},'POST');
   const body=await response.json();
   const accepted=response.ok&&!body.error&&!body.error_code&&body.success!==false&&body.ok!==false;
   code=accepted?'READ_UNCONFIRMED':'READ_REJECTED';
   if(accepted){
    const check=await shopeeRequest(config,'/api/v2/sellerchat/get_one_conversation',{conversation_id:text(conversation.external_conversation_id)},'GET');
    const result=await check.json();
    const current=result.response?.conversation??result.response;
    if(check.ok&&!result.error&&!result.error_code&&result.success!==false&&result.ok!==false&&text(current?.conversation_id)===text(conversation.external_conversation_id)){
     unreadCount=typeof current.unread_count==='number'&&Number.isInteger(current.unread_count)&&current.unread_count>=0?current.unread_count:null;
     lastReadMessageId=text(current.last_read_message_id)||null;
     // A newer buyer message may remain unread. Only acknowledge the pre-send snapshot.
     confirmed=unreadCount===0||lastReadMessageId===messageId;
     if(confirmed)code='READ_CONFIRMED';
    }
   }
  }
 }catch{code='READ_UNKNOWN';}
 let auditRecorded=false;
 try{
  const {error}=await db.from('conversation_activity_logs').insert({conversation_id:conversation.id,event_type:confirmed?'shopee_read_synced':'shopee_read_sync_failed',actor_type:actor.id?'user':'integration',actor_user_id:actor.id||null,actor_label:actor.label,source:'shopee-chat-send',summary:confirmed?'Status dibaca disahkan Shopee':'Mesej dihantar; status dibaca Shopee belum disahkan',metadata:{last_read_message_id:messageId,provider_last_read_message_id:lastReadMessageId,provider_unread_count:unreadCount,code},importance:'normal'});
  auditRecorded=!error;
 }catch{}
 return {confirmed,code,auditRecorded};
}
