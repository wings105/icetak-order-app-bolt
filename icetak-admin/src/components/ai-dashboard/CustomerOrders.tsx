import { useState } from 'react';
import { customerOrders, orderStages } from './orderStatus';
type Data=Record<string,any>;
const date=(v:unknown)=>v?new Date(String(v)).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const money=(v:unknown)=>v==null?'Jumlah belum tersedia':`RM ${Number(v).toFixed(2)}`;
export default function CustomerOrders({context,onOpenOrder,compact=false}:{context:Data;onOpenOrder:(ref:string)=>void;compact?:boolean}){
 const [filter,setFilter]=useState('all'),[copied,setCopied]=useState('');
 const orders=customerOrders(context),visible=orders.filter(o=>filter==='all'||o.stage===filter);
 return <section className={`ai-customer-orders ${compact?'compact':''}`} aria-label="Order pelanggan"><div className="ai-orders-title"><h3>Order pelanggan</h3><span>{orders.length}</span></div>
 <div className="ai-order-tabs" role="group" aria-label="Tapis status order">{Object.entries(orderStages).filter(([k])=>k==='all'||orders.some(o=>o.stage===k)).map(([k,label])=><button key={k} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{label} <small>{k==='all'?orders.length:orders.filter(o=>o.stage===k).length}</small></button>)}</div>
 {!orders.length?<p className="ai-muted">Tiada order dipadankan dalam data tersedia.</p>:<p className="ai-muted">Order berkaitan pelanggan · sahkan order yang dirujuk dalam chat. Maksimum 8 terkini setiap sumber.</p>}
 {visible.map(o=><article className="ai-order-tile" key={`${o.source}-${o.id}`}><div className="ai-order-tile-heading"><strong className={`ai-stage ${o.stage}`}>{orderStages[o.stage]}</strong><span className={`ai-channel ${o.source}`}>{o.source==='shopee'?'Shopee':'iCetak'}</span></div><div className="ai-order-reference"><b>{o.reference}</b><button title={`Salin order ID ${o.reference}`} aria-label={`Salin order ID ${o.reference}`} onClick={async()=>{try{await navigator.clipboard.writeText(o.reference);setCopied(o.reference);}catch{setCopied('Gagal salin');}}}>⧉</button></div>
 <small className="ai-muted">{date(o.placed_at||o.created_at)}</small>
 <div className="ai-order-payment"><strong>{o.source==='shopee'?money(o.financials?.[0]?.buyer_paid):money(o.total)}</strong><span>{o.payment_status||'Bayaran belum jelas'}</span></div>
 {((o.financials||[]).some((f:Data)=>/cash|cod/i.test(f.payment_method||''))||/cash|cod/i.test(o.payment_method||''))&&<p className="ai-warning">COD / tunai · semak penerimaan bayaran.</p>}
 {o.ship_by_at&&<p className="ai-ship-by">Ship by: <b>{date(o.ship_by_at)}</b></p>}
 {o.date_need&&<p>Tarikh perlu: <b>{date(o.date_need)}</b></p>}
 <details open={!compact}><summary>{o.items?.length||0} item · produk & penghantaran</summary>{o.items?.map((i:Data,n:number)=><div key={n} className="ai-order-product"><b>{i.quantity}× {i.title}</b><small>{[i.variation,i.size,i.sku&&`SKU ${i.sku}`,i.wording].filter(Boolean).join(' · ')}</small></div>)}
 {o.source==='shopee'&&!o.detail_complete&&<p className="ai-warning">Butiran order belum lengkap.</p>}
 {(o.shipments||[]).map((s:Data,n:number)=><p key={n}>{s.courier_name||'Courier belum tersedia'}<br/>{s.tracking_number||'Tiada tracking'}<br/><small>{s.shipment_status||s.fulfillment_status||'Status shipment belum tersedia'}</small></p>)}
 {o.source==='icetak'&&<p>{o.courier||'Courier belum tersedia'} · {o.tracking||'Tiada tracking'}<br/>{o.shipment_status||o.fulfillment_stage||'Status shipment belum tersedia'}</p>}
 <small className="ai-block">Status sumber: {o.current_status||o.status||'—'} · {o.fulfillment_status||o.fulfillment_stage||'—'}<br/>Dikemas kini: {date(o.latest_provider_update_at||o.updated_at)}</small>
 </details>{o.source==='icetak'&&<button onClick={()=>onOpenOrder(o.reference)}>Buka order ↗</button>}</article>)}
 {copied&&<small role="status">{copied==='Gagal salin'?copied:`Disalin: ${copied}`}</small>}
 </section>;
}
