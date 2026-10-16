import {supabase} from './supabase';
type Cached={shop_id:string;item_id:string;name:string;image_url:string;models:Array<{model_id:string;name:string;image_url:string}>};
const cache=new Map<string,Promise<Cached|null>>();let waiting:Array<{shop:string;item:string;resolve:(p:Cached|null)=>void}>=[];let timer:ReturnType<typeof setTimeout>|undefined;
export function productIdentity(data:unknown,shopId?:string){
 const rows:Record<string,unknown>[]=[];function walk(x:unknown,n=0){if(n>5||!x||typeof x!=='object')return;if(Array.isArray(x)){x.slice(0,20).forEach(v=>walk(v,n+1));return;}const row=x as Record<string,unknown>;rows.push(row);Object.values(row).forEach(v=>{if(v&&typeof v==='object')walk(v,n+1);});}walk(data);
 const find=(keys:string[])=>{for(const row of rows)for(const k of keys)if(/^\d+$/.test(String(row[k]??'')))return String(row[k]);return '';};
 return {shop:shopId&&/^\d+$/.test(shopId)?shopId:find(['shop_id']),item:find(['item_id','product_id']),model:find(['model_id'])};
}
async function flush(){
 timer=undefined;const batch=waiting.splice(0,40);
 try{const {data,error}=await supabase.rpc('icetak_inbox_catalog_lookup',{p_items:batch.map(x=>({shop_id:x.shop,item_id:x.item}))});for(const x of batch)x.resolve(!error?(data as Cached[]||[]).find(p=>p.shop_id===x.shop&&p.item_id===x.item)||null:null);}catch{batch.forEach(x=>x.resolve(null));}
 if(waiting.length&&!timer)timer=setTimeout(()=>void flush(),15);
}
export function lookupProduct(shop:string,item:string){
 if(!/^\d+$/.test(shop)||!/^\d+$/.test(item))return Promise.resolve(null);const key=shop+':'+item;if(cache.has(key))return cache.get(key)!;
 const promise=new Promise<Cached|null>(resolve=>{waiting.push({shop,item,resolve});if(!timer)timer=setTimeout(()=>void flush(),15);});
 cache.set(key,promise);if(cache.size>600)cache.delete(cache.keys().next().value!);return promise;
}
