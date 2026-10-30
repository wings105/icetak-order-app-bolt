import type { MoneyBreakdown as Breakdown } from '../lib/contribution';
import { profitMoney as money } from '../lib/orderProfit';
import './Contribution.css';
export default function MoneyBreakdown({data,currency='MYR',incomeOnly=false}:{data?:Breakdown;currency?:string;incomeOnly?:boolean}){
 if(!data)return <small className="ct-muted">Pecahan belum tersedia. Muat semula.</small>;
 const lines:[string,string,number|null|undefined][]=[['sales','Sales barang',data.sales],['fee','Fee platform (−)',data.fee],['courier','Courier direct (−)',data.courier]];
 if(data.adjustment!==0)lines.push(['adjustment','Pelarasan / postage (+/−)',data.adjustment]);
 lines.push(['nett','Nett selepas potongan',data.nett],['material','Modal bahan (−)',data.material],['packing','Kos packing (−)',data.packing],['extras','Kos tambahan lain (−)',data.extras]);
 return <div className="ct-arithmetic"><dl>{lines.map(([key,label,value])=>{
  const known=data.known?.[key],partial=known!=null&&known<data.orders;
  return <div key={key}><dt>{label}</dt><dd>{money(value,currency)}{partial&&<small className="ct-component-coverage">{known}/{data.orders} order · {data.orders-known} belum lengkap</small>}</dd></div>;
 })}</dl><small>{data.orders} order dalam kiraan{data.missing?` · ${data.missing} pecahan belum lengkap`:''}{incomeOnly?' · Modal belum ditolak daripada nilai besar':''}</small>{data.partial&&<small>Jumlah diketahui sahaja. Liputan setiap komponen boleh berbeza; angka untung kekal mengikut order yang cukup data.</small>}</div>;
}
