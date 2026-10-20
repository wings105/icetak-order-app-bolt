export type ShopeeCard={title:string;label:string;image?:string;fields:Array<{label:string;value:string}>;lines:string[]};
const labels:Record<string,string>={order:'Order Shopee',product:'Produk Shopee',item:'Produk Shopee',variation_card:'Pertanyaan variasi produk',bundle_message:'Bundle produk',new_voucher:'Voucher',return_refund_card:'Return / refund',order_cancel_card:'Pembatalan order',out_of_stock_reminder_card:'Stok habis',chat_order_invitation_card:'Jemputan order',item_list:'Senarai produk',faq_liveagent:'Pertanyaan customer',notification:'Notifikasi Shopee'};
function objects(value:unknown,depth=0):Record<string,unknown>[] {
 if(depth>5||!value||typeof value!=='object')return [];
 if(Array.isArray(value))return value.slice(0,20).flatMap(x=>objects(x,depth+1));
 const row=value as Record<string,unknown>;return [row,...Object.values(row).filter(x=>x&&typeof x==='object').flatMap(x=>objects(x,depth+1))];
}
function text(rows:Record<string,unknown>[],keys:string[]){for(const row of rows)for(const key of keys){const v=row[key];if((typeof v==='string'&&v.trim())||typeof v==='number')return String(v).slice(0,300);}return '';}
function named(value:unknown):string {
 if(typeof value==='string')return value.trim().slice(0,300);
 if(value&&typeof value==='object')return named((value as Record<string,unknown>).text);
 return '';
}
export function shopeeImageUrl(value:unknown):string|undefined {
 if(typeof value!=='string'||!value.trim())return undefined;
 const image=value.trim();
 if(/^https:\/\//i.test(image))return image;
 if(/^[a-zA-Z0-9_-]{8,160}$/.test(image))return 'https://cf.shopee.com.my/file/'+image;
 return undefined;
}
export function shopeeStickerUrl(data:unknown):string|undefined {
 const rows=objects(data);
 const direct=shopeeImageUrl(text(rows,['sticker_url','image_url','url']));
 if(direct)return direct;
 const pack=text(rows,['sticker_package_id']),id=text(rows,['sticker_id']);
 if(!/^[a-zA-Z0-9_-]{1,100}$/.test(pack)||!/^[a-zA-Z0-9_-]{1,40}$/.test(id))return undefined;
 return 'https://deo.shopeemobile.com/shopee/shopee-sticker-live-my/packs/'+pack+'/'+id+'@1x.png';
}
function price(value:unknown):string {
 if(!value||typeof value!=='object')return '';
 const row=value as Record<string,unknown>;
 const raw=row.discount_price??row.origin_price;
 if(raw===undefined||raw===null||raw===''||!/^\d+(\.\d+)?$/.test(String(raw)))return '';
 const amount=Number(raw)/100000;
 if(!Number.isFinite(amount)||amount<0)return '';
 const currency=String(row.currency||'');
 return (currency==='MYR'?'RM':currency?currency+' ':'')+amount.toFixed(2);
}
export function shopeeCard(type:string|undefined,data:unknown):ShopeeCard|null{
 if(!type||!labels[type])return null;
 const rows=objects(data);
 const product=rows.find(row=>row.item_card_v2&&typeof row.item_card_v2==='object')?.item_card_v2 as Record<string,unknown>|undefined;
 if(product&&(type==='variation_card'||type==='item')){
  const models=Array.isArray(product.item_model_v2)?product.item_model_v2 as Record<string,unknown>[]:[];
  const requestedId=text(rows.slice(0,1),['model_id']);
  const selected=models.find(model=>String(model.model_id)===requestedId)||(models.length===1?models[0]:undefined);
  const variation=selected?named(selected.name):'';
  const fields:Array<{label:string;value:string}>=[];
  if(variation)fields.push({label:'Variasi',value:variation});
  const amount=price(selected?.display_price??product.display_price);
  if(amount)fields.push({label:'Harga',value:amount});
  const image=shopeeImageUrl(selected?.image||product.thumb_url);
  return {title:named(product.name)||labels[type],label:labels[type],fields,lines:[],...(image?{image}:{})};
 }
 const fields:Array<{label:string;value:string}>=[];
 for(const [label,keys] of [['Order',['order_sn']],['Produk',['item_id','product_id']],['Variasi',['variation_name','model_name']],['Status',['order_status','return_status','order_delivery_status']],['Kuantiti',['quantity']],['Refund',['refund_amount']],['Voucher',['voucher_name','voucher_code','discount_percentage']]] as Array<[string,string[]]>){const value=text(rows,keys);if(value)fields.push({label,value});}
 const image=shopeeImageUrl(text(rows,['image_url','thumb_url','image']));
 const title=text(rows,['title','item_name','product_name','name','title_text'])||labels[type];
 const lines=[...new Set(rows.map(row=>text([row],['text','description','reason','message'])).filter(x=>x&&x!==title))].slice(0,5);
 return {title,label:labels[type],fields,lines,...(image?{image}:{})};
}

