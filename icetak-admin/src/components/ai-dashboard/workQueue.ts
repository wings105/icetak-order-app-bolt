import { orderStage } from './orderStatus.ts';
type Data = Record<string, any>;
export const workQueues = [
 {key:'urgent',label:'Segera',hint:'Deadline / permintaan segera',rank:0},
 {key:'review',label:'Perlu keputusan',hint:'Semak order, bayaran atau maklumat',rank:1},
 {key:'reply',label:'Perlu balas',hint:'Pertanyaan pelanggan',rank:2},
 {key:'waiting',label:'Menunggu pelanggan',hint:'Sudah dibalas · tunggu jawapan',rank:3},
 {key:'snoozed',label:'Ditangguhkan',hint:'Semak semula kemudian',rank:4},
 {key:'resolved',label:'Selesai',hint:'Semakan telah ditutup',rank:5},
];
const malaysiaDay=(value:number)=>new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
export function workQueue(row:Data, now=Date.now()) {
 const a=row.analysis||{},ctx=row.context||{};
 const state=({waiting_customer:'waiting',snoozed:'snoozed',resolved:'resolved'} as Record<string,string>)[a.status];
 if(state)return workQueues.find(q=>q.key===state)!;
 // Only a currently confirmed case order may promote this chat by its deadline.
 const binding=a.case?.binding_current&&a.case?.order;
 const order=binding&&(binding.kind==='icetak'?ctx.orders:ctx.marketplace_orders)?.find((o:Data)=>o.id===binding.id);
 const deadline=Date.parse(order?.ship_by_at||'');
 const due=order&&['to_ship','processing'].includes(orderStage(order))&&Number.isFinite(deadline)&&malaysiaDay(deadline)<=malaysiaDay(now);
 if(a.urgent||due)return workQueues[0];
 if(a.acknowledgement||a.workflow?.decision)return workQueues[1];
 if(ctx.identity_status==='ambiguous'||a.confidence==='rendah'||['payment','complaint','shipping','new_order'].includes(a.intent))return workQueues[1];
 return workQueues[2];
}
