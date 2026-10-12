import {shopeeCard} from '../lib/shopeeCards';
export function ShopeeMessageCard({type,data}:{type?:string;data?:unknown}){
 const card=shopeeCard(type,data);if(!card)return null;
 return <section aria-label={card.label} className="mb-1 min-w-[180px] max-w-[300px] overflow-hidden rounded-md border border-black/10 bg-black/[.025] p-3 dark:border-white/15 dark:bg-white/5">
  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{card.label}</span>
  {card.image&&<img src={card.image} alt="" loading="lazy" className="mt-2 max-h-28 max-w-full rounded object-contain" onError={e=>{e.currentTarget.hidden=true;}}/>}
  <h4 className="mt-1.5 break-words text-[13px] font-semibold leading-5">{card.title}</h4>
  <dl className="mt-2 space-y-1">{card.fields.map(x=><div key={x.label} className="flex flex-wrap gap-x-2 text-xs"><dt className="text-[var(--text-secondary)]">{x.label}</dt><dd className="break-all font-medium">{x.value}</dd></div>)}</dl>
  {card.lines.map((line,i)=><p key={i} className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">{line}</p>)}
 </section>;
}
