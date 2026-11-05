export type Settings = {enabled:boolean;recipient_phone:string;schedule_local_time:string;template_name:string|null;template_language:string};
export type Breakdown = Record<string,number|null>;
export type Totals = Record<string,any> & {sales:number|null;orders:number;contribution:number|null;contribution_orders:number;breakdown:Breakdown;channels?:Array<Totals & {channel:string}>};
export type Order = {reference?:string;fees?:number|null;courier?:number|null;shipping_collected?:number|null;shopee_shipping_net?:number|null;shopee_adjustments?:number|null;extras?:number|null;nett?:number|null;income_state?:string;state?:string;reasons?:string[];order_id:string;channel:string;day:string;sales:number|null;material:number|null;packing?:number|null;payout:number|null;contribution:number|null};
export type Channel = {channel:string;sales:number|null;orders:number};
export type Snapshot = {schema_version?:number;report_date:string;generated_at:string;basis:string;cost_basis:string;daily:Totals & {channels:Channel[]};mtd:Totals;alerts:Record<string,unknown>;orders:Order[]};
export type Run = {id:number;report_date:string;status:string;delivery_status:string|null;attempts:number;recipient_phone:string;sent_at:string|null;last_error:string|null;message_preview:string|null};
export type Data = {settings:Settings;snapshot:Snapshot|null;history:Run[]};
export const channelLabels:Record<string,string>={shopee:'Shopee',whatsapp:'WhatsApp / chat',pickup_trigger:'Pickup trigger',decocake_web:'Decocake Web',walkin:'Walk-in',unknown:'Belum dikenal pasti',other:'Lain-lain'};
export const channelColors:Record<string,string>={shopee:'#ee8154',whatsapp:'#12958c',pickup_trigger:'#8a78c8',decocake_web:'#497fc4',walkin:'#b79a58',unknown:'#8795a4',other:'#687888'};
export const number=(n:number|null|undefined)=>n==null?'—':new Intl.NumberFormat('en-MY',{maximumFractionDigits:0}).format(n);
export const money=(n:number|null|undefined)=>n==null?'Belum lengkap':new Intl.NumberFormat('en-MY',{style:'currency',currency:'MYR',minimumFractionDigits:2}).format(n);
export const compact=(n:number)=>new Intl.NumberFormat('en-MY',{notation:'compact',maximumFractionDigits:1}).format(n);
export const shortDate=(d:string)=>new Intl.DateTimeFormat('ms-MY',{day:'numeric',month:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(`${d}T12:00:00+08:00`));
export const dateTime=(d:string)=>new Date(d).toLocaleString('ms-MY',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kuala_Lumpur'});
export function yesterday(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()-86400000));}
export type Day = {date:string;sales:number;orders:number;missing:number};
export function daySeries(snapshot:Snapshot):Day[]{
 const start=snapshot.report_date.slice(0,8);const days=Array.from({length:Number(snapshot.report_date.slice(8))},(_,i)=>({date:start+String(i+1).padStart(2,'0'),sales:0,orders:0,missing:0}));
 for(const order of snapshot.orders){const d=days[Number(order.day.slice(8))-1];if(!d||d.date!==order.day)continue;d.orders++;if(order.sales==null)d.missing++;else d.sales+=Number(order.sales);}
 return days;
}
export function channelSeries(snapshot:Snapshot,period:'mtd'|'daily'):Channel[]{
 if(period==='daily')return [...snapshot.daily.channels].sort((a,b)=>Number(b.sales||0)-Number(a.sales||0));
 const map=new Map<string,Channel>();for(const o of snapshot.orders){const c=map.get(o.channel)||{channel:o.channel,sales:0,orders:0};c.sales=Number(c.sales||0)+Number(o.sales||0);c.orders++;map.set(o.channel,c);}return [...map.values()].sort((a,b)=>Number(b.sales||0)-Number(a.sales||0));
}
export function csvRows(orders:Order[]){const cell=(v:unknown)=>`"${String(v??'').replace(/"/g,'""')}"`;return '\ufeff'+[['Order ID','Reference','Channel','Tarikh','Jualan produk MYR','Fee MYR','Postage direct MYR','Courier direct MYR','Shipping Shopee bersih MYR','Pelarasan MYR','Nett MYR','Modal MYR','Packing MYR','Kos lain MYR','Baki sebelum overhead MYR','Status','Income basis','Sebab belum lengkap'],...orders.map(o=>[o.order_id,o.reference,channelLabels[o.channel]||o.channel,o.day,o.sales,o.fees,o.shipping_collected,o.courier,o.shopee_shipping_net,o.shopee_adjustments,o.nett,o.material,o.packing,o.extras,o.contribution,o.state,o.income_state,o.reasons?.join('; ')])].map(row=>row.map(cell).join(',')).join('\r\n');}

