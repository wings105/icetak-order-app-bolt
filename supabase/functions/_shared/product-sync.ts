const obj=(x:any)=>x&&typeof x==='object'&&!Array.isArray(x);
const id=(x:any)=>{if(!/^\d{1,15}$/.test(String(x))||!Number.isSafeInteger(Number(x)))throw Error('INVALID_ID');return Number(x);};
export function validateChange(operation:string,input:any){
 if(!obj(input))throw Error('INVALID_CHANGE');const d=JSON.parse(JSON.stringify(input));
 const keys:Record<string,string[]>={item:['item_name','description','item_sku','image'],price:['model_id','original_price'],stock:['model_id','stock'],model:['model_id','model_sku'],status:['unlist']};
 if(!keys[operation]||!Object.keys(d).length||Object.keys(d).some(k=>!keys[operation].includes(k)))throw Error('UNSUPPORTED_FIELD');
 if(operation==='item'){
  if(d.item_name!==undefined&&(typeof d.item_name!=='string'||d.item_name.length<1||d.item_name.length>120))throw Error('INVALID_TITLE');
  if(d.description!==undefined&&(typeof d.description!=='string'||d.description.length>10000))throw Error('INVALID_DESCRIPTION');
  if(d.item_sku!==undefined&&(typeof d.item_sku!=='string'||d.item_sku.length>100))throw Error('INVALID_SKU');
  if(d.image!==undefined&&(!obj(d.image)||Object.keys(d.image).some(k=>k!=='image_id_list')||!Array.isArray(d.image.image_id_list)||d.image.image_id_list.length<1||d.image.image_id_list.length>9||d.image.image_id_list.some((x:any)=>typeof x!=='string'||!/^[\w-]{8,160}$/.test(x))))throw Error('INVALID_IMAGE_IDS');
 }else if(operation==='status'){if(typeof d.unlist!=='boolean')throw Error('INVALID_STATUS');}
 else{d.model_id=id(d.model_id);if(operation==='price'&&(!Number.isFinite(d.original_price)||d.original_price<=0||d.original_price>100000))throw Error('INVALID_PRICE');if(operation==='stock'&&(!Number.isInteger(d.stock)||d.stock<0||d.stock>100000000))throw Error('INVALID_STOCK');if(operation==='model'&&(typeof d.model_sku!=='string'||d.model_sku.length>100))throw Error('INVALID_SKU');if(Object.keys(d).length!==2)throw Error('MISSING_MODEL_FIELD');}
 return d;
}
export function readState(item:any,models:any,operation:string,desired:any){
 const state:any={};if(operation==='item')for(const k of Object.keys(desired))state[k]=k==='image'?{image_id_list:item.image?.image_id_list||[]}:k==='description'?(item.description??item.description_info?.description??item.description_info?.extended_description?.field_list?.filter((x:any)=>x.field_type==='text').map((x:any)=>x.text||'').join('')??''):item[k]??'';
 else if(operation==='status')state.unlist=item.item_status==='UNLIST'?true:item.item_status==='NORMAL'?false:null;
 else{const model=models?.model?.find((m:any)=>String(m.model_id)===String(desired.model_id));const source=model||(Number(desired.model_id)===0?item:null);if(!source)throw Error('MODEL_NOT_FOUND');state.model_id=Number(desired.model_id);if(operation==='price')state.original_price=Number(source.price_info?.[0]?.original_price);if(operation==='stock'){
 const stocks=source.stock_info_v2?.seller_stock;state.stock=stocks?.length===1?Number(stocks[0].stock):!stocks?.length?Number(source.stock_info?.[0]?.normal_stock):null;
 if(state.stock===null)throw Error('MULTI_LOCATION_STOCK_REQUIRES_LOCATION');if(stocks?.[0]?.location_id)state.location_id=String(stocks[0].location_id);
 }if(operation==='model')state.model_sku=source.model_sku??'';}
 return state;
}
function stable(x:any):string{return JSON.stringify(x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))])):x);}
export const expectedMatches=(a:any,b:any)=>stable(a)===stable(b);
export const desiredMatches=(a:any,b:any,_op:string)=>expectedMatches(Object.fromEntries(Object.keys(b).map(k=>[k,a[k]])),b);
export function writeRequest(itemId:string,operation:string,d:any,context:any={}){const item_id=id(itemId);if(operation==='item'){const body:any={item_id,...d};if(d.description!==undefined){delete body.description;body.description_type='extended';body.description_info={extended_description:{field_list:[{field_type:'text',text:d.description}]}};}return {path:'update_item',body};}
 if(operation==='status')return {path:'unlist_item',body:{item_list:[{item_id,unlist:d.unlist}]}};
 if(operation==='price')return {path:'update_price',body:{item_id,price_list:[d]}};
 if(operation==='stock')return {path:'update_stock',body:{item_id,stock_list:[{model_id:d.model_id,seller_stock:[{stock:d.stock,...(context.location_id?{location_id:context.location_id}:{})}]}]}};
 return {path:'update_model',body:{item_id,model:[d]}};
}
