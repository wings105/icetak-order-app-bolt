import { api } from './appdeploy-client';

export type ProductKind='edible'|'burnaway'|'wafer'|'printed'|'mirror'|'acrylic';
export type Address={id?:string;address_line1?:string;address_line2?:string;city?:string;postcode?:string;state?:string;is_default?:boolean};
export type Customer={id:string;name:string;phone:string;addresses:Address[]};
export type CreateResult={order_id:string;order_db_id:string;order_token:string;customer_token:string;total:number;duplicate?:boolean;payment?:{transaction_id?:string;verified_by?:string};links?:{order_link?:string;customer_history_link?:string;admin_order_link?:string;components?:Array<{id:string;label:string;system_link:string;customer_link:string}>};clickup?:{status?:string;outbox_id?:string}};
export const PRODUCTS:Record<ProductKind,string>={edible:'Edible Image',burnaway:'Burn Away Combo',wafer:'Wafer Paper',printed:'Cake Topper',mirror:'Mirror Gold Topper',acrylic:'Acrylic Cake Topper'};
export const esc=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
export const money=(v:number)=>`RM${Number(v||0).toFixed(2)}`;
export function phone(v:string){const d=String(v||'').replace(/\D/g,'');const n=d.startsWith('60')?d:d.startsWith('0')?`60${d.slice(1)}`:d.startsWith('1')?`60${d}`:'';return /^601\d{8,9}$/.test(n)?`+${n}`:''}
export function localTime(){const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
export async function lookup(query:string){const r=await api.post('/api/admin/customer-lookup',{query});return (r.data?.matches||[]) as Customer[]}
export async function createOrder(payload:unknown){const r=await api.post('/api/admin/whatsapp-paid-order',payload);return r.data as CreateResult}
export function collect(form:HTMLFormElement){const d=new FormData(form);const items=Array.from(form.querySelectorAll<HTMLElement>('[data-wa-item]')).map(row=>{const i=row.dataset.waItem||'';return{k:String((row.querySelector<HTMLSelectElement>(`[name="kind_${i}"]`)?.value||'edible')),title:String(row.querySelector<HTMLInputElement>(`[name="title_${i}"]`)?.value||'').trim(),process:'Pre-order',review:String(row.querySelector<HTMLSelectElement>(`[name="review_${i}"]`)?.value||'No Review'),size:String(row.querySelector<HTMLInputElement>(`[name="size_${i}"]`)?.value||''),style:String(row.querySelector<HTMLInputElement>(`[name="style_${i}"]`)?.value||''),customText:String(row.querySelector<HTMLInputElement>(`[name="text_${i}"]`)?.value||''),price:Number(row.querySelector<HTMLInputElement>(`[name="price_${i}"]`)?.value||0),qty:Number(row.querySelector<HTMLInputElement>(`[name="qty_${i}"]`)?.value||1)}}).filter(x=>x.title&&x.qty>0&&x.price>=0);
return{data:d,items,name:String(d.get('name')||'').trim(),phone:phone(String(d.get('phone')||'')),delivery:String(d.get('delivery')||'pickup'),transactionId:String(d.get('transaction_id')||'').trim()}}
