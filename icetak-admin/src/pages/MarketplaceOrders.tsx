import {DetailSummary} from '../components/OrderDetailSession';
import {detailRequest,detailDate,detailStage,type DetailData} from '../lib/orderDetails';
const OrderDetailSession=lazy(()=>import('../components/OrderDetailSession'));
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './MarketplaceOrders.css';
import OrderProfitDetail from '../components/OrderProfitDetail';
import {profitMoney,profitRequest,profitStateLabel} from '../lib/orderProfit';
import type {OrderProfitRow} from '../lib/orderProfit';

type Item={title?:string;sku?:string;variation?:string;qty?:number;imageUrl?:string};
type Row={
  id:string;provider:string;orderSn:string;buyerUsername:string;status:string;paymentStatus:string;
  fulfillmentStatus:string;courier:string;placedAt?:string;shipByAt?:string;updatedAt?:string;
  customerMasterId?:string;customerName?:string;phone?:string;buyerPaid?:number;currency?:string;
  paymentMethod?:string;tracking?:string;shipmentStatus?:string;itemCount?:number;items?:Item[];
};
type Payload={ok?:boolean;total?:number;rows?:Row[];summary?:{all?:number;toShip?:number;toProcess?:number;processed?:number;readyToShip?:number;shipped?:number;completed?:number;cancelled?:number;shipByToday?:number;shipByTomorrow?:number}};
type Props={initialSearch?:string;onOpenCustomer?:(id:string)=>void;canViewFinance?:boolean;canManageFinance?:boolean;canViewDetails?:boolean;onOpenChat?:(id:string)=>void};

const fmtDate=(v?:string)=>v?new Date(v).toLocaleString('en-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'-';
const money=(n?:number,c='MYR')=>new Intl.NumberFormat('en-MY',{style:'currency',currency:c||'MYR'}).format(Number(n||0));
const statusLabel=(s:string)=>s.replaceAll('_',' ');
const badgeClass=(s:string)=>{const x=s.toLowerCase();return x.includes('cancel')?'danger':x.includes('complete')?'success':x.includes('ship')?'info':x.includes('ready')?'warn':'neutral'};

export default function MarketplaceOrders({initialSearch='',onOpenCustomer,canViewFinance=false,canManageFinance=false,canViewDetails=false,onOpenChat}:Props){
  const [search,setSearch]=useState(initialSearch);
  const [status,setStatus]=useState(()=>{const value=new URLSearchParams(window.location.search).get('mp_status')||'all';return ['all','TO_SHIP','READY_TO_SHIP','PROCESSED','SHIPPED','COMPLETED','CANCELLED'].includes(value)?value:'all';});
  const [provider,setProvider]=useState('all');
  const [shipBy,setShipBy]=useState(()=>{const value=new URLSearchParams(window.location.search).get('mp_ship_by')||'all';return ['all','today','tomorrow','overdue'].includes(value)?value:'all';});
  const [payload,setPayload]=useState<Payload>({rows:[],summary:{}});
  const [loading,setLoading]=useState(false);
  const [offset,setOffset]=useState(0);
  const [profits,setProfits]=useState<Record<string,OrderProfitRow>>({});
  const [profitError,setProfitError]=useState('');
  const [selectedFinance,setSelectedFinance]=useState<string|null>(null);
  const [details,setDetails]=useState<Record<string,DetailData>>({}),[detailError,setDetailError]=useState(''),[detailKey,setDetailKey]=useState<string|null>(null),[detailVersion,setDetailVersion]=useState(0);
  const limit=50;

  const load=async(nextOffset=0)=>{
    setLoading(true);
    const {data,error}=await supabase.rpc('icetak_admin_marketplace_orders',{
      p_search:search,p_status:status,p_provider:provider,p_ship_by:shipBy,p_limit:limit,p_offset:nextOffset
    });
    if(error){ console.error(error); setPayload({rows:[],summary:{}}); }
    else { setPayload((data||{}) as Payload); setOffset(nextOffset); }
    setLoading(false);
  };

  useEffect(()=>{const t=window.setTimeout(()=>void load(0),220);return()=>window.clearTimeout(t)},[search,status,provider,shipBy]);
  const rows=payload.rows||[];
  useEffect(()=>{
    if(!canViewFinance)return;let active=true;setProfits({});setProfitError('');
    const ids=(payload.rows||[]).map(r=>r.id);
    if(ids.length)void profitRequest<OrderProfitRow[]>({action:'order_profit_summaries',order_ids:ids}).then(data=>{if(active)setProfits(Object.fromEntries(data.map(r=>[r.order_id,r])))}).catch(e=>{if(active)setProfitError(e.message)});
    return()=>{active=false};
  },[payload,canViewFinance]);
  useEffect(()=>{if(!canViewDetails)return;let active=true;setDetails({});setDetailError('');const keys=(payload.rows||[]).map(r=>'shopee:'+r.id);
    if(keys.length)void detailRequest({action:'order_details',keys}).then(d=>{if(active)setDetails(Object.fromEntries(d.rows.map((r:DetailData)=>[r.id,r])))}).catch(e=>{if(active)setDetailError(e.message)});return()=>{active=false};
  },[payload,canViewDetails,detailVersion]);
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
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value)}catch{const el=document.createElement('textarea');el.value=value;document.body.appendChild(el);el.select();document.execCommand('copy');el.remove()}};

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
    {inToShip&&<>
      <div className="mp-substatus">
        <span>Order Status</span>
        <button className={status==='TO_SHIP'?'active':''} onClick={()=>setStatus('TO_SHIP')}>All <b>{summary.toShip||0}</b></button>
        <button className={status==='READY_TO_SHIP'?'active':''} onClick={()=>setStatus('READY_TO_SHIP')}>To Process <b>{summary.toProcess||0}</b></button>
        <button className={status==='PROCESSED'?'active':''} onClick={()=>setStatus('PROCESSED')}>Processed <b>{summary.processed||0}</b></button>
      </div>
      <div className="mp-substatus">
        <span>Shipping Priority</span>
        <button className={shipBy==='all'?'active':''} onClick={()=>setShipBy('all')}>All</button>
        <button className={shipBy==='today'?'active':''} onClick={()=>setShipBy('today')}>Ship By Today <b>{summary.shipByToday||0}</b></button>
        <button className={shipBy==='tomorrow'?'active':''} onClick={()=>setShipBy('tomorrow')}>Ship By Tomorrow <b>{summary.shipByTomorrow||0}</b></button>
      </div>
    </>}

    <div className="mp-toolbar">
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order SN, buyer username, customer, phone, SKU, item, tracking, courier..." />
      <select value={provider} onChange={e=>setProvider(e.target.value)}>
        <option value="all">All marketplaces</option><option value="shopee">Shopee</option>
      </select>
    </div>

    <div className="mp-table-wrap">
      {canViewFinance&&profitError&&<div className="op-alert error" role="alert">Finance: {profitError}</div>}
      {canViewDetails&&detailError?<div className="op-alert error" role="alert">Detail / session: {detailError} <button onClick={()=>setDetailVersion(v=>v+1)}>Cuba semula</button></div>:null}
      <table className={'mp-table'+(canViewDetails?' mp-table-details':'')}>
        <thead><tr><th>ORDER</th><th>PLACED / SHIP BY</th><th>BUYER</th><th>ITEMS</th>{canViewDetails?<><th>DETAIL ORDER</th><th>FOLLOW-UP / DEADLINE</th><th>CLICKUP / PRODUCTION</th></>:null}<th>PAID</th><th>COURIER / TRACKING</th><th>STATUS</th></tr></thead>
        <tbody>
          {loading&&<tr><td colSpan={canViewDetails?10:7} className="mp-empty">Loading marketplace orders...</td></tr>}
          {!loading&&rows.length===0&&<tr><td colSpan={canViewDetails?10:7} className="mp-empty">No marketplace orders found.</td></tr>}
          {!loading&&rows.map(r=><tr key={r.id}>
            <td><div className="mp-order"><div className="mp-copyline"><b>{r.orderSn}</b><button title="Copy order ID" onClick={()=>void copy(r.orderSn)}>⧉</button></div><span className="mp-provider">{r.provider}</span></div></td>
            <td><div>{fmtDate(r.placedAt)}</div><small>Ship by: {fmtDate(r.shipByAt)}</small></td>
            <td>
              <div className="mp-buyer">
                <b>{r.customerName||r.buyerUsername||'-'}</b>
                <div className="mp-copyline"><span>@{r.buyerUsername||'-'}</span>{r.buyerUsername&&<button title="Copy username" onClick={()=>void copy(r.buyerUsername)}>⧉</button>}</div>
                {r.phone&&<div className="mp-phone-row"><a href={'whatsapp://send?phone='+r.phone}>{r.phone}</a><a className="mp-wa-btn" href={'https://wa.me/'+r.phone} target="_blank" rel="noreferrer">WhatsApp</a></div>}
                {r.customerMasterId&&onOpenCustomer&&<button onClick={()=>onOpenCustomer(r.customerMasterId!)}>Open CRM</button>}
              </div>
            </td>
            <td><div className="mp-items">{(r.items||[]).slice(0,2).map((i,idx)=><div key={idx}>
              {i.imageUrl&&<img src={i.imageUrl} alt="" />}<span><b>{i.qty||1}×</b> {i.title||i.sku||'Item'}<small>{i.variation||i.sku||''}</small></span>
            </div>)}{Number(r.itemCount||0)>2&&<small>+{Number(r.itemCount||0)-2} more</small>}</div></td>
            {canViewDetails?<><td><DetailSummary data={details[r.id]?.detail_collection} onOpen={()=>setDetailKey('shopee:'+r.id)}/></td><td><div>{details[r.id]?detailStage[details[r.id].detail_collection.stage]:'Menyemak…'}</div><small>Deadline detail: {detailDate(details[r.id]?.detail_collection.deadline)}</small>{details[r.id]?.detail_collection.followup.sent_at?<small>Follow-up: {detailDate(details[r.id].detail_collection.followup.sent_at)}</small>:null}<small>Session: {details[r.id]?.detail_collection.session_linked?'Linked':'Belum dipadankan'}</small></td><td>{details[r.id]?.production_tasks?.length?details[r.id].production_tasks.map((t:DetailData)=><div key={t.id}><a href={/^https:\/\//.test(t.url||'')?t.url:undefined} target="_blank" rel="noreferrer">{t.title||t.id}</a><small>{t.status}</small><small>{t.detail?.customize_name||''}</small></div>):<small>{details[r.id]?'Belum ada task dipadankan':'Menyemak…'}</small>}<small>Order dalaman: {details[r.id]?.internal_order_id?'Linked':'Belum linked'}</small></td></>:null}
            <td><b>{money(r.buyerPaid,r.currency)}</b><small>{r.paymentMethod||r.paymentStatus||''}</small>{canViewFinance&&<div className="op-mp-finance"><button onClick={()=>setSelectedFinance(r.id)}>Nett {profitMoney(profits[r.id]?.nett,r.currency)}<br/><span className={(profits[r.id]?.profit??0)<0?'op-negative':''}>Untung {profitMoney(profits[r.id]?.profit,r.currency)}</span></button><small>{profits[r.id]?profitStateLabel(profits[r.id]):profitError?'Finance gagal dimuatkan':'Memuatkan finance…'}</small></div>}</td>
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
    {detailKey?<Suspense fallback={<p>Memuatkan detail…</p>}><OrderDetailSession rowKey={detailKey} onClose={()=>setDetailKey(null)} onSaved={()=>setDetailVersion(v=>v+1)} onOpenChat={onOpenChat}/></Suspense>:null}
    {selectedFinance&&<OrderProfitDetail key={selectedFinance} orderId={selectedFinance} canManage={canManageFinance} onClose={()=>setSelectedFinance(null)} onSaved={r=>setProfits(prev=>({...prev,[r.order_id]:r}))}/>}
  </div>
}
