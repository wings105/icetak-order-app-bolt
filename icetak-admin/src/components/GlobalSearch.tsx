import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconSearch, IconX } from './Icons';
import './GlobalSearch.css';

type InternalResult={type:'internal';orderNo:string;status:string;customer:string;phone:string;total:number;createdAt?:string};
type MarketplaceResult={type:'marketplace';provider:string;orderSn:string;status:string;buyerUsername:string;customer:string;phone:string;total:number;createdAt?:string};
type Payload={internalOrders?:InternalResult[];marketplaceOrders?:MarketplaceResult[]};
type Props={
  onOpenInternalOrder:(orderNo:string)=>void;
  onOpenMarketplace:(query:string)=>void;
};

export default function GlobalSearch({onOpenInternalOrder,onOpenMarketplace}:Props){
  const [open,setOpen]=useState(false);
  const [q,setQ]=useState('');
  const [loading,setLoading]=useState(false);
  const [data,setData]=useState<Payload>({});
  const inputRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{if(open) window.setTimeout(()=>inputRef.current?.focus(),30)},[open]);
  useEffect(()=>{
    if(!open||q.trim().length<2){setData({});return}
    const t=window.setTimeout(async()=>{
      setLoading(true);
      const {data,error}=await supabase.rpc('icetak_admin_global_search',{p_search:q.trim(),p_limit:8});
      if(!error)setData((data||{}) as Payload); else console.error(error);
      setLoading(false);
    },180);
    return()=>window.clearTimeout(t);
  },[q,open]);

  const close=()=>{setOpen(false);setQ('');setData({})};
  return <>
    <button className="topbar-btn" title="Global Search" onClick={()=>setOpen(true)}><IconSearch size={18}/></button>
    {open&&<div className="gs-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
      <div className="gs-modal">
        <div className="gs-input-row"><IconSearch size={19}/><input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search iCetak + Shopee orders, customer, phone, tracking, SKU..." /><button onClick={close}><IconX size={18}/></button></div>
        <div className="gs-results">
          {q.trim().length<2&&<div className="gs-hint">Type at least 2 characters.</div>}
          {loading&&<div className="gs-hint">Searching...</div>}
          {!loading&&q.trim().length>=2&&!(data.internalOrders?.length||data.marketplaceOrders?.length)&&<div className="gs-hint">No matching orders.</div>}
          {!!data.internalOrders?.length&&<section><h4>iCetak Orders</h4>{data.internalOrders.map(r=><button key={r.orderNo} className="gs-result" onClick={()=>{close();onOpenInternalOrder(r.orderNo)}}>
            <span><b>{r.orderNo}</b><small>{r.customer||r.phone||'Internal order'}</small></span><span className="gs-right"><b>RM {Number(r.total||0).toFixed(2)}</b><small>{r.status}</small></span>
          </button>)}</section>}
          {!!data.marketplaceOrders?.length&&<section><h4>Marketplace Orders</h4>{data.marketplaceOrders.map(r=><button key={r.orderSn} className="gs-result" onClick={()=>{close();onOpenMarketplace(r.orderSn)}}>
            <span><b>{r.orderSn}</b><small>{r.provider?.toUpperCase()} · @{r.buyerUsername||r.customer}</small></span><span className="gs-right"><b>RM {Number(r.total||0).toFixed(2)}</b><small>{r.status}</small></span>
          </button>)}</section>}
        </div>
      </div>
    </div>}
  </>
}
