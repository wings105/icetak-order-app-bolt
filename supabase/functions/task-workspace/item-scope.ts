type Data=Record<string,any>;
const text=(v:unknown)=>String(v??'').trim();
const normal=(v:unknown)=>text(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const ignored=new Set('custom name happy birthday cake topper decoration set party accessories banner hiasan kek design print printing service edible image acrylic wafer paper urgent review only same day ship nama'.split(' '));
// An explicit item label is required for multi-item content. Never allocate by position.
export function itemContent(raw:unknown,item:Data,items:Data[]){
 const value=text(raw).replace(/\\n/g,'\n').replace(/\\"/g,'"');
 const parts=[...value.matchAll(/(?:^|\n)\s*([^:\n]{1,120})\s*:\s*([^]*?)(?=\n[^:\n]{1,120}\s*:|$)/g)];
 const words=(i:Data)=>new Set(normal(i.title).split(' ').filter(w=>w.length>=3&&!ignored.has(w)));
 const chosen=parts.filter(p=>{
  const label=normal(p[1]),tokens=new Set(label.split(' '));
  const matches=items.filter(i=>text(i.sku)&&label.includes(normal(i.sku))||[...words(i)].some(w=>tokens.has(w)));
  return matches.length===1&&matches[0]===item;
 });
 return chosen.map(p=>p[2].trim().replace(/^["“]|["”]$/g,'')).filter(Boolean).join('\n');
}
export function scopeCustomer(source:Data,order:Data|null,context:Data,exact:Data|null){
 if(!order||order.items?.length<=1)return {order,context,allow:!!order};
 const sku=text(source.fields?.sku||source.item?.sku)||text(source.title).match(/\b(?:CN|EI|WF|WP)\d{3,6}\b/i)?.[0]||'';
 const matches=order.items.filter((i:Data)=>sku&&text(i.sku).toLowerCase()===sku.toLowerCase());
 const item=matches.length===1?matches[0]:exact&&order.items.find((i:Data)=>i.id&&i.id===exact.id);
 if(!item)return {order:{...order,order_note:''},context:{...context,messages:[]},allow:false};
 const note=itemContent(order.order_note,item,order.items);
 const messages=(context.messages||[]).flatMap((m:Data)=>{
  const assigned=itemContent(m.text_content||m.caption,item,order.items);
  return assigned?[{...m,text_content:assigned,caption:assigned}]:[];
 });
 return {order:{...order,order_note:note},context:{...context,messages},allow:true};
}
