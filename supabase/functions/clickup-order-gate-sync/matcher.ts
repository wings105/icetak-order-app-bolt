export const ORDER_FIELD='a8996f77-fcf9-4804-84bb-89f97905473d';
const SET_FIELD='2670446d-5e5a-48ac-931d-c2be790d6b3b',SKU_FIELD='34c62cbb-c174-42e8-9c50-8301f68269a8';
export const orderOf=(t:any)=>String(t.custom_fields?.find((f:any)=>f.id===ORDER_FIELD)?.value||'').trim().toUpperCase();
const norm=(v:any)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export function coverage(tasks:any[],products:any[]){
 if(!products?.length||tasks.length!==products.length)return false;
 if(products.length===1)return true;
 const sets=new Set<number>();
 for(const t of tasks){const f=t.custom_fields?.find((f:any)=>f.id===SET_FIELD);const values=Array.isArray(f?.value)?f.value:[];
  const labels=values.map((v:any)=>typeof v==='object'?v.label:f.type_config?.options?.find((o:any)=>o.id===v)?.label);
  const indexes=labels.map((v:any)=>/^set\s*(\d+)$/i.exec(String(v||''))).filter(Boolean).map((m:any)=>Number(m[1]));
  if(indexes.length===1)sets.add(indexes[0]);
 }
 if(sets.size===products.length&&products.every((_,i)=>sets.has(i+1)))return true;
 const candidates=tasks.map(t=>{const sku=norm(t.custom_fields?.find((f:any)=>f.id===SKU_FIELD)?.value);return products.map((p,i)=>({p,i})).filter(({p})=>sku&&[p.variation_sku,p.variation,p.sku].some(v=>norm(v)&&norm(v)===sku)).map(x=>x.i);});
 const seen=new Set<number>();let solutions=0;const match=(i:number):void=>{if(solutions>1)return;if(i===tasks.length){solutions++;return;}for(const j of candidates[i])if(!seen.has(j)){seen.add(j);match(i+1);seen.delete(j);}};
 match(0);return solutions===1;
}
