// Read-only provider projection: no buyer, address, credentials or arbitrary API path.
export function normalizeOrders(raw:any,shop:string,ids:string[]){
 if(!Array.isArray(raw)||raw.length!==ids.length)throw Error('ORDER_DETAIL_INCOMPLETE');
 const seen=new Set<string>();
 return raw.map((o:any)=>{
  if(!ids.includes(o.order_sn)||seen.has(o.order_sn)||!Array.isArray(o.item_list)||!o.item_list.length||o.item_list.length>100)throw Error('ORDER_DETAIL_INCOMPLETE');
  seen.add(o.order_sn);
  const currency=String(o.currency||'');if(currency!==(shop==='188218638'?'MYR':'SGD'))throw Error('ORDER_CURRENCY_MISMATCH');
  const items=o.item_list.map((x:any)=>{
   const quantity=Number(x.model_quantity_purchased);
   if(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000||!/^[0-9]+$/.test(String(x.item_id))||!String(x.item_name||'').trim())throw Error('ITEM_DETAIL_INVALID');
   const price=(p:any)=>p===null||p===undefined?null:typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1000000?p:(()=>{throw Error('ITEM_PRICE_INVALID')})();
   return {item_id:String(x.item_id),model_id:x.model_id==null?null:String(x.model_id),sku:String(x.item_sku||''),model_sku:String(x.model_sku||''),model:String(x.model_name||''),title:String(x.item_name),quantity,unit_original_price:price(x.model_original_price),unit_discounted_price:price(x.model_discounted_price)};
  });
  return {order_sn:o.order_sn,shop_id:shop,currency,status:String(o.order_status||''),create_time:Number(o.create_time)||null,update_time:Number(o.update_time)||null,items};
 });
}
