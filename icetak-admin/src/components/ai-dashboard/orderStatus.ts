type Data = Record<string, any>;
export const orderStages: Record<string,string> = {all:'Semua',to_ship:'To Ship',shipping:'Shipping',delivered:'Delivered',completed:'Completed',unpaid:'Unpaid',pickup:'Pickup',processing:'Processing',cancelled:'Cancelled',issue:'Return / issue',unknown:'Belum jelas'};
const norm=(v:unknown)=>String(v||'').trim().toUpperCase().replace(/\s+/g,'_');
export function orderStage(o:Data):string {
 const status=norm(o.current_status||o.status), stage=norm(o.fulfillment_status||o.fulfillment_stage);
 const shipments=o.shipments||[];
 const logistics=[stage,norm(o.shipment_status),...shipments.flatMap((s:Data)=>[norm(s.shipment_status),norm(s.fulfillment_status)])];
 if(['CANCELLED','CANCELED'].includes(status))return 'cancelled';
 if(['IN_CANCEL','TO_RETURN','RETURNED','REFUNDED'].includes(status))return 'issue';
 // Completion is a commercial state, not proof of courier delivery.
 if(['COMPLETED','CUSTOMER_COLLECTED'].includes(status)||stage==='COLLECTED')return 'completed';
 if(logistics.some(s=>['LOGISTICS_DELIVERY_FAILED','DELIVERY_FAILED'].includes(s)))return 'issue';
 if(logistics.some(s=>['LOGISTICS_DELIVERY_DONE','DELIVERED','DELIVERED,_RECEIVED_BY_CUSTOMER','PARCEL_HAS_BEEN_RECEIVED'].includes(s)))return 'delivered';
 if(['SHIPPED','TO_CONFIRM_RECEIVE'].includes(status)||logistics.some(s=>['LOGISTICS_PICKUP_DONE','IN_TRANSIT','SHIPPED'].includes(s)))return 'shipping';
 if(status==='UNPAID')return 'unpaid';
 if(status==='READY_FOR_PICKUP'||stage==='READY_FOR_PICKUP')return 'pickup';
 if(['READY_TO_SHIP','PROCESSED'].includes(status)||stage==='READY_TO_SHIP')return 'to_ship';
 if(['READY_TO_PROCESS','PROCESSING','IN_PRODUCTION'].includes(status))return 'processing';
 return 'unknown';
}
export function customerOrders(context:Data){
 const rows=[...(context.orders||[]).map((o:Data)=>({...o,source:'icetak',reference:o.order_no})),...(context.marketplace_orders||[]).map((o:Data)=>({...o,source:'shopee',reference:o.order_sn}))];
 const rank=['issue','unpaid','to_ship','processing','pickup','shipping','delivered','unknown','completed','cancelled'];
 return rows.map(o=>({...o,stage:orderStage(o)})).sort((a,b)=>rank.indexOf(a.stage)-rank.indexOf(b.stage)||(Date.parse(b.placed_at||b.created_at)||0)-(Date.parse(a.placed_at||a.created_at)||0));
}
