import { useCallback, useEffect, useState } from 'react';
import { IconRefresh } from '../components/Icons';
import { supabase } from '../lib/supabase';
import './DraftOrders.css';

type Draft={
  id:string;status:string;source_type:string;customer_name:string|null;customer_phone:string|null;
  draft_total:number|string;payment_status:string;payment_required:boolean;transaction_id:string|null;
  payment_amount:number|string|null;review_token:string;admin_approved_at:string|null;
  customer_confirmed_at:string|null;date_need:string|null;delivery:string|null;item_count:number;
  created_at:string;updated_at:string;payment_available:boolean|null;
};
type DraftData={counts:{all:number;linked:number;unlinked:number};drafts:Draft[]};
type ApiResponse<T>={success:boolean;data?:T;error?:string};
const money=(v:number|string|null)=>`RM ${Number(v||0).toFixed(2)}`;
const when=(v:string)=>new Date(v).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'});
async function finance<T>(body:Record<string,unknown>){
  const {data,error}=await supabase.functions.invoke('finance-admin',{body});
  if(error)throw new Error(error.message);
  return data as ApiResponse<T>;
}
export default function DraftOrders({canManage=false,onOpenOrder}:{canManage?:boolean;onOpenOrder?:(orderNo:string)=>void}){
  const [data,setData]=useState<DraftData>({counts:{all:0,linked:0,unlinked:0},drafts:[]});
  const [query,setQuery]=useState('');const [status,setStatus]=useState('');
  const [loading,setLoading]=useState(true);const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState('');const [links,setLinks]=useState<Record<string,string>>({});
  const load=useCallback(async()=>{setLoading(true);setError('');try{
    const r=await finance<DraftData>({action:'draft_orders',query,status,limit:200});
    if(!r.success||!r.data)throw new Error(r.error||'Draft list failed');setData(r.data);
  }catch(e){setError(e instanceof Error?e.message:'Draft list failed')}finally{setLoading(false)}},[query,status]);
  useEffect(()=>{const t=window.setTimeout(()=>void load(),250);return()=>window.clearTimeout(t)},[load]);
  const edit=(d:Draft)=>window.open(`https://shop.decocake.my/qrpay-draft.html?token=${encodeURIComponent(d.review_token)}`,'_blank','noopener,noreferrer');
  const detach=async(d:Draft)=>{if(!d.transaction_id||!confirm(`Detach ${d.transaction_id} daripada draft ${d.customer_name||d.id}?\n\nPayment tidak dipadam dan akan kembali ke Needs Review.`))return;
    setBusy(d.id);setError('');try{const r=await finance({action:'draft_detach_payment',draft_id:d.id});if(!r.success)throw new Error(r.error||'Detach failed');await load()}catch(e){setError(e instanceof Error?e.message:'Detach failed')}finally{setBusy(null)}};
  const link=async(d:Draft,confirmed=false)=>{const tx=(links[d.id]||'').trim();if(!tx)return setError('Masukkan QRPay transaction ID dahulu.');
    if(!confirm(`Link ${tx} kepada draft ${d.customer_name||d.id} dan CREATE ORDER?`))return;
    setBusy(d.id);setError('');try{
      let r=await finance<{success?:boolean;requires_confirmation?:boolean;requires_mismatch_confirmation?:boolean;order_no?:string}>({action:'draft_link_payment',draft_id:d.id,transaction_id:tx,confirm_mismatch:confirmed});
      if(!r.success&&(r.data?.requires_confirmation||r.data?.requires_mismatch_confirmation)){
        if(confirm('Phone atau jumlah tidak sepadan. Teruskan dengan amaran?'))r=await finance({action:'draft_link_payment',draft_id:d.id,transaction_id:tx,confirm_mismatch:true});
      }
      if(!r.success)throw new Error(r.error||'Link payment failed');
      const orderNo=(r.data as {order_no?:string}|undefined)?.order_no; if(orderNo&&onOpenOrder)onOpenOrder(orderNo);else await load();
    }catch(e){setError(e instanceof Error?e.message:'Link payment failed')}finally{setBusy(null)}};
  return <div className="draft-orders-page">
    <div className="draft-orders-head"><div><h1>Draft Orders</h1><p>Semak, edit dan betulkan hubungan QRPay sebelum order masuk production.</p></div><button className="btn btn-outline" onClick={()=>void load()} disabled={loading}><IconRefresh size={16}/> Refresh</button></div>
    <div className="draft-stats"><div><span>Active Draft</span><b>{data.counts.all}</b></div><div><span>QRPay Linked</span><b>{data.counts.linked}</b></div><div><span>Belum Linked</span><b>{data.counts.unlinked}</b></div></div>
    <div className="draft-tools"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari nama, phone, transaction atau draft ID…"/><select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option><option value="pending_admin">Pending Admin</option><option value="awaiting_payment">Awaiting Payment</option><option value="customer_review">Customer Review</option></select></div>
    {error&&<div className="draft-error">{error}</div>}
    {loading?<div className="draft-empty">Loading drafts…</div>:data.drafts.length===0?<div className="draft-empty">Tiada draft dijumpai.</div>:<div className="draft-grid">{data.drafts.map(d=><article className="draft-card" key={d.id}>
      <div className="draft-card-top"><div><span className="draft-status">{d.status.replaceAll('_',' ')}</span><h2>{d.customer_name||'Customer belum dikenal pasti'}</h2><a href={d.customer_phone?`https://wa.me/${d.customer_phone}`:undefined}>{d.customer_phone||'Phone belum ada'}</a></div><strong>{money(d.draft_total)}</strong></div>
      <div className="draft-meta"><span>{d.item_count} item</span><span>{d.date_need||'Date belum pilih'}</span><span>{d.delivery&&d.delivery!=='unknown'?d.delivery:'Delivery belum pilih'}</span><span>{when(d.updated_at)}</span></div>
      {d.transaction_id?<div className="draft-payment wrong"><div><span>QRPay linked</span><b>{d.transaction_id} · {money(d.payment_amount)}</b></div><small>Pastikan payment memang milik customer ini.</small></div>:<div className="draft-payment"><span>Belum ada payment linked</span></div>}
      <div className="draft-actions"><button className="btn btn-outline" onClick={()=>edit(d)}>Open / Edit Draft</button>{canManage&&d.transaction_id&&<button className="btn btn-danger" disabled={busy===d.id} onClick={()=>void detach(d)}>Detach QRPay</button>}</div>
      {canManage&&!d.transaction_id&&<div className="draft-link"><input value={links[d.id]||''} onChange={e=>setLinks(x=>({...x,[d.id]:e.target.value}))} placeholder="Contoh QR02086824"/><button className="btn btn-primary" disabled={busy===d.id||!(links[d.id]||'').trim()} onClick={()=>void link(d)}>Link Payment & Create Order</button><small>Edit dan Save Draft dahulu. Link akan terus create order + production + ClickUp.</small></div>}
    </article>)}</div>}
  </div>;
}