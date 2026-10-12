export type ShopeeCard={title:string;label:string;image?:string;fields:Array<{label:string;value:string}>;lines:string[]};
const labels:Record<string,string>={order:'Order Shopee',item:'Produk Shopee',variation_card:'Pilihan produk',bundle_message:'Bundle produk',new_voucher:'Voucher',return_refund_card:'Return / refund',order_cancel_card:'Pembatalan order',out_of_stock_reminder_card:'Stok habis',chat_order_invitation_card:'Jemputan order',item_list:'Senarai produk',faq_liveagent:'Pertanyaan customer',notification:'Notifikasi Shopee'};
function objects(value:unknown,depth=0):Record<string,unknown>[] {
 if(depth>5||!value||typeof value!=='object')return [];
 if(Array.isArray(value))return value.slice(0,20).flatMap(x=>objects(x,depth+1));
 const row=value as Record<string,unknown>;return [row,...Object.values(row).filter(x=>x&&typeof x==='object').flatMap(x=>objects(x,depth+1))];
}
function text(rows:Record<string,unknown>[],keys:string[]){for(const row of rows)for(const key of keys){const v=row[key];if((typeof v==='string'&&v.trim())||typeof v==='number')return String(v).slice(0,300);}return '';}
export function shopeeCard(type:string|undefined,data:unknown):ShopeeCard|null{
 if(!type||!labels[type])return null;const rows=objects(data);const fields:Array<{label:string;value:string}>=[];
 for(const [label,keys] of [['Order',['order_sn']],['Produk',['item_id','product_id']],['Variation',['model_id','variation_name','model_name']],['Status',['order_status','return_status','order_delivery_status']],['Kuantiti',['quantity']],['Refund',['refund_amount']],['Voucher',['voucher_name','voucher_code','discount_percentage']]] as Array<[string,string[]]>){const value=text(rows,keys);if(value)fields.push({label,value});}
 const image=text(rows,['image_url','thumb_url','image']);const title=text(rows,['title','item_name','product_name','name','label','title_text'])||labels[type];
 const lines=[...new Set(rows.map(row=>text([row],['text','description','reason','message'])).filter(x=>x&&x!==title))].slice(0,5);
 return {title,label:labels[type],fields,lines,...(/^https:\/\//i.test(image)?{image}:{} )};
}
