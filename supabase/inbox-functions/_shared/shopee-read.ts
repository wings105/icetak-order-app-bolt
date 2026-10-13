import {shopeeRequest} from './shopee-direct.ts';
export async function markShopeeRead(db:any,config:any,conversation:any,messageId:string,actor:any) {
 let ok=false,code='READ_UNKNOWN';
 try {
  const response=await shopeeRequest(config,'/api/v2/sellerchat/read_conversation',{conversation_id:String(conversation.external_conversation_id),last_read_message_id:messageId,business_type:0},'POST');
  const body=await response.json();
  ok=response.ok&&!body.error&&!body.error_code&&body.success!==false&&body.ok!==false;
  code=ok?'READ_CONFIRMED':'READ_REJECTED';
 }catch{code='READ_UNKNOWN';}
 try{await db.from('conversation_activity_logs').insert({conversation_id:conversation.id,event_type:ok?'shopee_read_synced':'shopee_read_sync_failed',actor_type:'staff',actor_id:actor.id,actor_label:actor.label,source:'shopee-chat-send',summary:ok?'Status dibaca disahkan Shopee':'Mesej dihantar; status dibaca Shopee belum disahkan',metadata:{last_read_message_id:messageId,code},importance:'normal'});}catch{}
 return ok;
}
