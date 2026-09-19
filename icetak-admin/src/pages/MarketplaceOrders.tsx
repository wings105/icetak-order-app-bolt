import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './MarketplaceOrders.css';

type Item={title?:string;sku?:string;variation?:string;qty?:number;imageUrl?:string};
type Row={
  id:string;provider:string;orderSn:string;buyerUsername:string;status:string;paymentStatus:string;
  fulfillmentStatus:string;courier:string;placedAt?:string;shipByAt?:string;updatedAt?:string;
  customerMasterId?:string;customerName?:string;phone?:string;buyerPaid?:number;currency?:string;
  paymentMethod?:string;tracking?:string;shipmentStatus?:string;itemCount?:number;items?:Item[];
};
type Payload={ok?:boolean;total?:number;rows?:Row[];summary?:{all?:number;toShip?:number;toProcess?:number;processed?:number;readyToShip?:number;shipped?:number;completed?:number;cancelled?:number}};
type Props={initialSearch?:string;onOpenCustomer?:(id:string)=>void};

const fmtDate=(v?:string)=>v?new Date(v).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
const money=(n?:number,c='MYR')=>new Intl.NumberFormat('en-MY',{style:'currency',currency:c||'MYR'}).format(Number(n||0));
const statusLabel=(s:string)=>s.replaceAll('_',' ');
const badgeClass=(s:string)=>{const x=s.toLowerCase();return x.includes('cancel')?'danger':x.includes('complete')?'success':x.includes('ship')?'info':x.includes('ready')?'warn':'neutral'};

export default function MarketplaceOrders({initialSearch='',onOpenCustomer}:Props){
  const [search,setSearch]=useState(initialSearch);
  const [status,setStatus]=useState('all');
  const [provider,setProvider]=useState('all');
  const [payload,setPayload]=useState<Payload>({rows:[],summary:{}});
  const [loading,setLoading]=useState(false);
  const [offset,setOffset]=useState(0);
  const limit=50;

  const load=async(nextOffset=0)=>{
    setLoading(true);
    const {data,error}=await supabase.rpc('icetak_admin_marketplace_orders',{
      p_search:search,p_status:status,p_provider:provider,p_limit:limit,p_offset:nextOffset
    });
    if(error){ console.error(error); setPayload({rows:[],summary:{}}); }
    else { setPayload((data||{}) as Payload); setOffset(nextOffset); }
    setLoading(false);
  };

  useEffect(()=>{const t=window.setTimeout(()=>void load(0),220);return()=>window.clearTimeout(t)},[search,status,provider]);
  const rows=payload.rows||[];
  const total=Number(payload.total||0);
  const summary=payload.summary||{};
  const tabs=useMemo(()=>[
    ['all','All',summary.all||0],
    ['TO_SHIP','To Ship',summary.toShip||0],
    ['SHIPPED','Shipped',summary.shipped||0],
    ['COMPLETED','Completed',summary.completed||0],
    ['CANCELLED','Cancelled',summary.cancelled||0],
  ] as const,[summary]);
  const inToShip=status==='TO_SHIP'||status==='READY_TO_SHIP'||status==='PROCESSED';

  return <div className="mp-page">
    <div className="mp-head">
      <div><h2>Marketplace Orders</h2><p>Shopee order database — separate from iCetak internal orders.</p></div>
      <button className="mp-refresh" onClick={()=>void load(offset)}>Refresh</button>
    </div>

    <div className="mp-summary">
      {tabs.map(([key,label,count])=><button key={key} className={(key==='TO_SHIP'?inToShip:status===key)?'active':''} onClick={()=>setStatus(key)}>
        <span>{label}</span><b>{count}</b>
      </button>)}
    </div>
    {inToShip&&<div className="mp-substatus">
      <span>Order Status</span>
      <button className={status==='TO_SHIP'?'active':''} onClick={()=>setStatus('TO_SHIP')}>All <b>{summary.toShip||0}</b></button>
      <button className={status==='READY_TO_SHIP'?'active':''} onClick={()=>setStatus('READY_TO_SHIP')}>To Process <b>{summary.toProcess||0}</b></button>
      <button className={status==='PROCESSED'?'active':''} onClick={()=>setStatus('PROCESSED')}>Processed <b>{summary.processed||0}</b></button>
    </div>}

    <div className="mp-toolbar">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order SN, buyer username, customer, phone, SKU, item, tracking, courier..." />
      <select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="all">All marketplaces</option><option value="shopee">Shopee</option>
      </select>
    </div>

    <div className="mp-table-wrap">
      <table className="mp-table">
        <thead><tr><th>ORDER</th><th>PLACED / SHIP BY</th><th>BUYER</th><th>ITEMS</th><th>PAID</th><th>COURIER / TRACKING</th><th>STATUS</th></tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={7} className="mp-empty">Loading marketplace orders...</td></tr>}
          {!loading&&rows.length===0&&<tr><td colSpan={7} className="mp-empty">No marketplace orders found.</td></tr>}
          {!loading&&rows.map(r=><tr key={r.id}>
            <td><div className="mp-order"><b>{r.orderSn}</b><span className="mp-provider">{r.provider}</span></div></td>
            <td><div>{fmtDate(r.placedAt)}</div><small>Ship by: {fmtDate(r.shipByAt)}</small></td>
            <td>
              <div className="mp-buyer">
                <b>{r.customerName||r.buyerUsername||'-'}</b>
                <span>@{r.buyerUsername||'-'}</span>
                {r.phone&&<small>{r.phone}</small>}
                {r.customerMasterId&&onOpenCustomer&&<button onClick={()=>onOpenCustomer(r.customerMasterId!)}>Open CRM</button>}
              </div>
            </td>
            <td><div className="mp-items">{(r.items||[]).slice(0,2).map((i,idx)=><div key={idx}>
              {i.imageUrl&&<img src={i.imageUrl} alt="" />}<span><b>{i.qty||1}×</b> {i.title||i.sku||'Item'}<small>{i.variation||i.sku||''}</small></span>
            </div>)}{Number(r.itemCount||0)>2&&<small>+{Number(r.itemCount||0)-2} more</small>}</div></td>
            <td><b>{money(r.buyerPaid,r.currency)}</b><small>{r.paymentMethod||r.paymentStatus||''}</small></td>
            <td><div>{r.courier||'-'}</div><small>{r.tracking||r.shipmentStatus||'-'}</small></td>
            <td><span className={'mp-status '+badgeClass(r.status)}>{statusLabel(r.status||'UNKNOWN')}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>

    <div className="mp-pager">
      <span>{total?offset+1:0}-{Math.min(offset+limit,total)} of {total}</span>
      <div><button disabled={offset===0||loading} onClick={()=>void load(Math.max(0,offset-limit))}>Previous</button><button disabled={offset+limit>=total||loading} onClick={()=>void load(offset+limit)}>Next</button></div>
    </div>
  </div>
}
