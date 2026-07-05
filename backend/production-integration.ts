import { randomUUID } from 'crypto';
import { db } from '@appdeploy/sdk';

export async function getProductionStatus(){
  const {items}=await db.list<{key:string;value:string}>('integration_settings',{filter:{key:'production_webhook_url'}});
  return {configured:Boolean(items[0]?.value),url:items[0]?.value||''};
}

export async function setProductionUrl(url:string){
  const clean=url.trim();
  if(clean&&!clean.startsWith('https://'))throw new Error('Webhook URL mesti bermula dengan https://');
  const {items}=await db.list<{key:string;value:string}>('integration_settings',{filter:{key:'production_webhook_url'}});
  const record={key:'production_webhook_url',value:clean,updated_at:Date.now()};
  if(items[0])await db.update('integration_settings',[{id:items[0].id,record}]);
  else await db.add('integration_settings',[record]);
  return clean;
}

export async function queueProduction(orderToken:string,source='payment'){
  const {items:orders}=await db.list<any>('orders',{filter:{public_token:orderToken}});
  const order=orders[0];
  if(!order||order.payment!=='Paid')return {ok:false,status:'not_ready'};
  const {items:items}=await db.list<any>('order_items',{filter:{order_token:orderToken}});
  const {items:components}=await db.list<any>('production_components',{filter:{order_token:orderToken}});
  const payload={event:'order.ready_for_production',event_id:`evt_${randomUUID()}`,sent_at:new Date().toISOString(),order:{order_id:order.order_id,order_token:order.public_token,date_need:order.date_need,total:order.total,payment_status:order.payment,delivery:order.delivery},customer:{name:order.delivery_name||'',phone:order.delivery_phone||''},products:components.map((c:any)=>{const item=items.find((i:any)=>i.id===c.item_id);return {component_id:c.id,product:c.label,quantity:item?.qty||1,size:item?.size||'',style:item?.style||'',wording:item?.custom_text||'',review_required:c.review_required}})};
  const status=await getProductionStatus();
  await db.add('integration_outbox',[{event_type:payload.event,order_token:orderToken,payload,status:status.configured?'pending_send':'waiting_configuration',source,created_at:Date.now()}]);
  if(!status.configured)return {ok:false,status:'waiting_configuration'};
  const response=await fetch(status.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
  return {ok:response.ok,status:response.ok?'sent':`http_${response.status}`};
}

export async function syncPaidProductionOrders(){
  const {items:orders}=await db.list<any>('orders');
  const {items:queued}=await db.list<any>('integration_outbox');
  const existing=new Set(queued.filter((x:any)=>x.event_type==='order.ready_for_production').map((x:any)=>x.order_token));
  for(const order of orders){
    if(order.payment==='Paid'&&!existing.has(order.public_token))await queueProduction(order.public_token,'paid_order_scan');
  }
  return {ok:true};
}
