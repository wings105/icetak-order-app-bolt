import {useEffect,useState} from 'react';
import {lookupProduct,productIdentity} from '../lib/productCatalog';
import {shopeeCard} from '../lib/shopeeCards';
export function ShopeeMessageCard({type,data,shopId}:{type?:string;data?:unknown;shopId?:string}){
 const original=shopeeCard(type,data);const [fallback,setFallback]=useState<{image?:string;title?:string}|null>(null);const identity=productIdentity(data,shopId);
 useEffect(()=>{let active=true;setFallback(null);if(original&&!original.image&&identity.shop&&identity.item)void lookupProduct(identity.shop,identity.item).then(p=>{if(active&&p){const m=p.models?.find(x=>x.model_id===identity.model);setFallback({image:m?.image_url||p.image_url,title:p.name});}});return()=>{active=false;};},[identity.shop,identity.item,identity.model,original?.image]);
 if(!original)return null;const card={...original,image:original.image||fallback?.image,title:original.title===original.label?(fallback?.title||original.title):original.title};
 return <section aria-label={card.label} className="mb-1 min-w-[180px] max-w-[300px] overflow-hidden rounded-md border border-black/10 bg-black/[.025] p-3 dark:border-white/15 dark:bg-white/5">
  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{card.label}</span>
  {card.image&&<img src={card.image} alt="" loading="lazy" className="mt-2 max-h-28 max-w-full rounded object-contain" onError={e=>{e.currentTarget.hidden=true;}}/>}
  <h4 className="mt-1.5 break-words text-[13px] font-semibold leading-5">{card.title}</h4>
  <dl className="mt-2 space-y-1">{card.fields.map(x=><div key={x.label} className="flex flex-wrap gap-x-2 text-xs"><dt className="text-[var(--text-secondary)]">{x.label}</dt><dd className="break-all font-medium">{x.value}</dd></div>)}</dl>
  {card.lines.map((line,i)=><p key={i} className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{line}</p>)}
 </section>;
}
