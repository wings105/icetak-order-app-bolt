export const ORDER='a8996f77-fcf9-4804-84bb-89f97905473d',SKU='34c62cbb-c174-42e8-9c50-8301f68269a8',SET='2670446d-5e5a-48ac-931d-c2be790d6b3b';
export const value=(t:any,id:string)=>t.custom_fields?.find((f:any)=>f.id===id)?.value;
const norm=(s:any)=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const tokens=(i:any)=>[i.model,i.model_sku,i.sku].map(norm).filter(s=>s.length>1);
export function combinedEvidence(items:any[],tasks:any[],comments:string[]){
 const text=norm(comments.join('\n')+'\n'+tasks.map(t=>t.description||t.text_content||'').join('\n'));
 return items.every((i,k)=>tokens(i).filter(v=>!items.some((j,n)=>n!==k&&tokens(j).includes(v))).some(v=>text.includes(v)));
}
export function assess(order:any,tasks:any[],comments:string[]=[]){
 const issue=(kind:string,detail:any)=>({kind,order_sn:order.order_sn,shop_id:order.shop_id,detail:{...detail,task_ids:tasks.map(t=>t.id)}});
 if(!tasks.length)return [issue('missing_order',{expected_items:order.items.length})];
 if(tasks.length>order.items.length)return [issue('extra_or_duplicate_tasks',{expected_items:order.items.length,actual_tasks:tasks.length})];
 if(tasks.length<order.items.length)return combinedEvidence(order.items,tasks,comments)?[]:[issue('missing_item_or_unverified_combination',{expected_items:order.items.length,actual_tasks:tasks.length,items:order.items})];
 // Only an explicit quantity prefix before words is reliable. Dimension
 // names such as "5 × 5 inch" and "6 x 6 inch" are never quantities.
 const qty=(t:any)=>String(t.name||'').match(/^\s*(\d+)\s*x\s+(?=[^\d\s])/i)?.[1];
 if(tasks.length===1){const q=qty(tasks[0]);return q&&Number(q)!==Number(order.items[0].quantity||1)?[issue('quantity_mismatch',{expected:order.items[0].quantity,task_quantity:Number(q)})]:[];}
 const sets=tasks.map(t=>(value(t,SET)||[]).filter((s:string)=>['80bb319b-02c0-45d3-9ee1-4fcba7e3ee4b','88b687e3-1e73-44a3-b7e0-156217c7640c','4ab6c5d3-c585-4dae-abcb-5f09ef1e7403','93d579cf-c2cd-44c4-b6a7-59138a2213a2','5b6cb0da-f2bd-4b34-8274-b488094f4950'].includes(s)).join(','));
 if(sets.every(Boolean)&&new Set(sets).size<sets.length)return [issue('duplicate_set',{sets})];
 // Unique variation/SKU evidence must cover every item. Set numbers alone do
 // not prove which product a task represents.
 const candidates=order.items.map((i:any,n:number)=>{const discriminators=tokens(i).filter(v=>!order.items.some((j:any,m:number)=>m!==n&&tokens(j).includes(v)));return tasks.map((t,k)=>({k,text:norm(value(t,SKU))+' '+norm(t.name)})).filter(x=>discriminators.some(v=>x.text.includes(v))&&(!qty(tasks[x.k])||Number(qty(tasks[x.k]))===Number(i.quantity||1))).map(x=>x.k);});
 const match=(n:number,used:Set<number>):boolean=>n===candidates.length||candidates[n].some((k:number)=>!used.has(k)&&match(n+1,new Set([...used,k])));
 return match(0,new Set())?[]:[issue('item_match_requires_review',{items:order.items})];
}
