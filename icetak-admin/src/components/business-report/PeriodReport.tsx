import {channelLabels,money,number} from './model';
import type {Totals} from './model';

export function PeriodReport({title,totals:t}:{title:string;totals:Totals}){
 const b=t.breakdown;
 const rows:[string,number|null|undefined,number|null|undefined][]=[
  ['Jualan produk',t.sales,b.sales],['+ Postage direct dikutip',t.shipping_collected,b.shipping_collected],
  ['+ Shipping Shopee bersih (+/−)',t.shopee_shipping_net,b.shopee_shipping_net],['+ Pelarasan Shopee lain (+/−)',t.shopee_adjustments,b.shopee_adjustments],
  ['− Fee Shopee',t.fees,b.fees],['− Kos courier direct',t.courier_total,b.courier_total],
  ['− Modal bahan',t.material,b.material],['− Packing',t.packing_total,b.packing_total],['− Kos lain',t.other_extras,b.other_extras],
 ];
 return <section className="br-panel br-period"><div className="br-panel-heading"><div><h2>{title}</h2><p>{number(t.orders)} order berbayar · anggaran dan sebenar mengikut sumber semasa</p></div><div className="br-period-balance"><small>Baki sebelum overhead</small><strong>{money(t.contribution)}</strong><span>{number(t.contribution_orders)}/{number(t.orders)} order dikira</span></div></div>
 <div className="br-table-scroll"><table><thead><tr><th>Komponen</th><th>Semua order · nilai diketahui</th><th>Kiraan sepadan · {number(t.contribution_orders)} order</th></tr></thead><tbody>{rows.map(([label,all,matched])=><tr key={label}><td>{label}</td><td>{money(all)}</td><td>{money(matched)}</td></tr>)}<tr className="br-period-total"><td>Baki sebelum overhead</td><td>{t.contribution_complete?money(t.contribution):'Sebahagian kos belum lengkap'}</td><td>{money(t.contribution)}</td></tr></tbody></table></div>
 <p className="br-chart-footnote">Kolum kiraan sepadan menggunakan kumpulan order yang sama untuk setiap tambah/tolak. {t.missing_contribution?`${number(t.missing_contribution)} order bernilai ${money(t.pending_sales)} belum termasuk dalam baki: modal ${number(t.missing_costs)} order, nett/courier ${number(t.missing_nett)} order belum lengkap.`:'Semua order mempunyai kiraan baki.'} {number(t.estimated_orders)} anggaran · {number(t.actual_orders)} sebenar.</p>
 <div className="br-settlement br-period-settlement"><div><span>Cash out Shopee keseluruhan</span><b>{money(t.cash_out)}</b></div><div><span>Sudah released</span><b>{money(t.released_payout)}</b></div><div><span>Anggaran belum release</span><b>{money(t.pending_cash_out)}</b></div></div>
 <p className="br-chart-footnote">Cash out sudah menolak fee dan mengambil kira shipping Shopee. Jadual di atas bermula daripada jualan, jadi setiap kos ditolak sekali. Shipping bersih = caj pelanggan + subsidi − courier − SST. Pelarasan lain ialah baki beza kepada nett provider{t.shipping_detail_missing?`, termasuk shipping belum diperincikan bagi ${number(t.shipping_detail_missing)} order`:''}. Modal berdasarkan harga jualan/kategori bagi {number(t.material_price_estimates)} order yang belum ada harga item. Packing: kadar item tertinggi sekali setiap order; pickup RM0.</p>
 <div className="br-table-scroll"><table><thead><tr><th>Saluran</th><th>Jualan</th><th>Fee</th><th>Modal diketahui</th><th>Packing</th><th>Baki sebelum overhead</th><th>Order dikira</th></tr></thead><tbody>{t.channels?.map(c=><tr key={c.channel}><td>{channelLabels[c.channel]||c.channel}</td><td>{money(c.sales)}</td><td>{money(c.fees)}</td><td>{money(c.material)}</td><td>{money(c.packing_total)}</td><td>{money(c.contribution)}</td><td>{number(c.contribution_orders)}/{number(c.orders)}</td></tr>)}</tbody></table></div>
 </section>;
}
