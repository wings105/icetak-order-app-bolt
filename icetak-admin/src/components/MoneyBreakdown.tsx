import type { MoneyBreakdown as Breakdown } from '../lib/contribution';
import { profitMoney as money } from '../lib/orderProfit';
import './Contribution.css';
export default function MoneyBreakdown({data,currency='MYR',incomeOnly=false}:{data?:Breakdown;currency?:string;incomeOnly?:boolean}){
 if(!data)return <small className="ct-muted">Pecahan belum tersedia. Muat semula.</small>;
 const lines:[string,number|null][]=[['Sales barang',data.sales],['Fee platform (−)',data.fee],['Courier direct (−)',data.courier]];
 if(data.adjustment!==0)lines.push(['Pelarasan / postage (+/−)',data.adjustment]);
 lines.push(['Nett selepas potongan',data.nett]);
 lines.push(['Modal bahan (−)',data.material],['Kos tambahan (−)',data.extras]);
 return <div className="ct-arithmetic"><dl>{lines.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{money(value,currency)}</dd></div>)}</dl><small>{data.orders} order dalam kiraan{data.missing?` · ${data.missing} pecahan belum lengkap`:''}{incomeOnly?' · Modal belum ditolak daripada nilai besar':''}</small></div>;
}
