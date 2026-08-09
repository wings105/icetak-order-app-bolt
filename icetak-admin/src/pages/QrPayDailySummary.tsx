import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { IconRefresh } from '../components/Icons';
import { supabase } from '../lib/supabase';
import './QrPayDailySummary.css';

type Totals = {
  total_count:number; total_amount:number|string; matched_count:number; matched_amount:number|string;
  review_count:number; review_amount:number|string; processing_count:number; processing_amount:number|string;
  missed_count:number; missed_amount:number|string; unresolved_count:number; unresolved_amount:number|string;
};
type Row = {
  source:'matched'|'unmatched'; transaction_id:string; amount:number|string; paid_at:string; sender_name:string|null;
  provider:string; workflow_status:'matched_order'|'needs_review'|'processing'|'pending'|'missed';
  order_id:string|null; order_no:string|null; phone:string|null; whatsapp_link:string|null; order_link:string|null;
  job_status:string|null; review_status:string|null;
};
type Delivery = { slot:string; status:string; attempts:number; scheduled_at:string; sent_at:string|null; recipient_phone:string|null; last_error:string|null };
type Summary = { date:string; timezone:string; generated_at:string; totals:Totals; rows:Row[]; delivery:Delivery|null };
type Candidate = {
  order_id:string; order_no:string; total:number|string; delivery_fee:number|string; created_at:string;
  payment_status:string|null; payment_transaction_id:string|null; customer_name:string; phone:string|null;
  phone_match:boolean; amount_difference:number|string; score:number; can_match:boolean; blocked_reason:string|null;
};
type CandidateData = {
  transaction?: { transaction_id:string; amount:number|string; paid_at:string; provider:string; phone:string|null; customer_name:string|null };
  already_matched:boolean; candidates:Candidate[];
};
type MatchData = {
  success:boolean; requires_confirmation?:boolean; order_no?:string; payment_amount?:number|string;
  order_total?:number|string; amount_difference?:number|string; phone_match?:boolean;
};
type Props = { onOpenOrder?:(orderNo:string)=>void; canManage?:boolean };

const money=(value:number|string|null|undefined)=>`RM ${Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const time=(value:string)=>new Date(value).toLocaleTimeString('en-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'});
const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'—';
const malaysiaDate=()=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(type:string)=>parts.find((item)=>item.type===type)?.value||'';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

async function invokeFinance<T>(body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke('finance-admin',{body});
  if(error)throw new Error(error.message);
  if(!data?.success)throw new Error(data?.error||'Finance request failed');
  return data.data as T;
}

const loadDaily=(date:string)=>invokeFinance<Summary>({action:'qrpay_daily',date});
const statusInfo=(row:Row)=>{
  if(row.workflow_status==='matched_order')return {label:row.provider==='qrpay_ai'?'Order auto-created':'Matched to order',cls:'badge-success'};
  if(row.workflow_status==='needs_review')return {label:'Needs review',cls:'badge-warning'};
  if(row.workflow_status==='missed')return {label:'Missed / failed',cls:'badge-error'};
  return {label:'Processing',cls:'badge-info'};
};

export default function QrPayDailySummary({onOpenOrder,canManage=false}:Props){
  const params=new URLSearchParams(window.location.search);
  const initial=/^\d{4}-\d{2}-\d{2}$/.test(params.get('date')||'')?params.get('date')!:malaysiaDate();
  const [date,setDate]=useState(initial);
  const [summary,setSummary]=useState<Summary|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [success,setSuccess]=useState<string|null>(null);
  const [matchRow,setMatchRow]=useState<Row|null>(null);
  const [matchQuery,setMatchQuery]=useState('');
  const [candidateData,setCandidateData]=useState<CandidateData|null>(null);
  const [selected,setSelected]=useState<Candidate|null>(null);
  const [matchLoading,setMatchLoading]=useState(false);
  const [matchError,setMatchError]=useState<string|null>(null);

  const load=useCallback(async()=>{
    setLoading(true);setError(null);
    try{
      const next=await loadDaily(date);setSummary(next);
      const url=new URL(window.location.href);url.searchParams.set('admin','v2');url.searchParams.set('view','qrpay-summary');url.searchParams.set('date',date);window.history.replaceState({},'',url);
    }catch(e){setError(e instanceof Error?e.message:'QRPay summary failed to load');}
    finally{setLoading(false);}
  },[date]);
  useEffect(()=>{void load();},[load]);

  const searchCandidates=useCallback(async(row:Row,query:string)=>{
    setMatchLoading(true);setMatchError(null);setSelected(null);
    try{
      const data=await invokeFinance<CandidateData>({action:'qrpay_match_candidates',transaction_id:row.transaction_id,query:query.trim()||null});
      setCandidateData(data);
      setSelected(data.candidates.find((candidate)=>candidate.can_match)||null);
    }catch(e){setCandidateData(null);setMatchError(e instanceof Error?e.message:'Order search failed');}
    finally{setMatchLoading(false);}
  },[]);

  const openMatch=(row:Row)=>{
    const query=row.order_no||row.phone||'';
    setMatchRow(row);setMatchQuery(query);setCandidateData(null);setSelected(null);setMatchError(null);
    void searchCandidates(row,'');
  };
  const closeMatch=()=>{if(!matchLoading){setMatchRow(null);setCandidateData(null);setSelected(null);setMatchError(null);}};
  const submitSearch=(event:FormEvent)=>{event.preventDefault();if(matchRow)void searchCandidates(matchRow,matchQuery);};
  const confirmMatch=async()=>{
    if(!matchRow||!selected)return;
    setMatchLoading(true);setMatchError(null);
    try{
      const mismatch=Math.abs(Number(selected.amount_difference||0))>=0.01||!selected.phone_match;
      const data=await invokeFinance<MatchData>({
        action:'qrpay_manual_match',transaction_id:matchRow.transaction_id,order_no:selected.order_no,confirm_mismatch:mismatch,
      });
      setSuccess(`${matchRow.transaction_id} sudah dipadankan kepada ${data.order_no||selected.order_no}.`);
      setMatchRow(null);setCandidateData(null);setSelected(null);
      await load();
    }catch(e){setMatchError(e instanceof Error?e.message:'Manual match failed');}
    finally{setMatchLoading(false);}
  };

  const totals=summary?.totals;
  return <div className="fade-in qrpay-summary-page">
    <div className="page-header"><div><h1 className="page-title">QRPay Daily Summary</h1><p className="page-subtitle">Semak semua QRPay Malaysia-day: sudah masuk order, masih review, sedang proses atau terlepas.</p></div><div className="qrpay-summary-actions"><input type="date" value={date} max={malaysiaDate()} onChange={(e)=>setDate(e.target.value)}/><button className="btn btn-outline" disabled={loading} onClick={()=>void load()}><IconRefresh size={16}/> Refresh</button></div></div>
    {success&&<div className="finance-alert qrpay-match-success"><b>Payment matched</b><span>{success}</span></div>}
    {error&&<div className="finance-alert"><b>QRPay error</b><span>{error}</span></div>}
    {loading&&!summary?<div className="loading"><span className="spinner"/> Loading QRPay summary…</div>:summary&&<>
      <div className="qrpay-summary-metrics">
        <Metric label="Jumlah QRPay Masuk" value={money(totals?.total_amount)} hint={`${totals?.total_count||0} transaksi`} cls="green"/>
        <Metric label="Sudah Masuk Order" value={money(totals?.matched_amount)} hint={`${totals?.matched_count||0} matched / auto-created`} cls="blue"/>
        <Metric label="Perlu Semakan" value={money(totals?.review_amount)} hint={`${totals?.review_count||0} tunggu tindakan`} cls="amber"/>
        <Metric label="Terlepas / Failed" value={money(totals?.missed_amount)} hint={`${totals?.missed_count||0} perlu diperiksa`} cls="red"/>
      </div>
      <div className="qrpay-summary-note"><div><b>Automation 10:00 AM & 10:00 PM</b><span>WhatsApp dihantar ke nombor admin order. Setiap slot mempunyai idempotency dan retry.</span></div><div><b>{summary.delivery?.status?summary.delivery.status.toUpperCase():'WAITING'}</b><span>{summary.delivery?.sent_at?`Last sent ${dateTime(summary.delivery.sent_at)}`:'Belum dihantar untuk tarikh ini'}</span></div></div>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">QRPay {summary.date}</div><div className="panel-subtitle">{summary.rows.length} transaksi · Generated {dateTime(summary.generated_at)} · MYT</div></div><div className="qrpay-unresolved"><b>{totals?.unresolved_count||0}</b><span>belum masuk order</span></div></div>
        <div className="table-wrap">{summary.rows.length===0?<div className="empty"><div className="empty-title">Tiada QRPay diterima pada tarikh ini.</div></div>:<table><thead><tr><th>Time</th><th>Transaction</th><th>Customer / Phone</th><th>Amount</th><th>Status</th><th>Proceed</th></tr></thead><tbody>{summary.rows.map((row)=>{const status=statusInfo(row);return <tr key={row.transaction_id} className={row.workflow_status==='missed'?'qrpay-row-missed':'row-hover'}><td className="cell-sub">{time(row.paid_at)}</td><td><div className="cell-id">{row.transaction_id}</div><div className="cell-sub">{row.provider}</div></td><td><div className="cell-name">{row.sender_name||'Customer belum dikenal pasti'}</div>{row.phone?<a className="qrpay-phone" href={row.whatsapp_link||undefined} target="_blank" rel="noreferrer">{row.phone}</a>:<div className="cell-sub">Phone belum jumpa</div>}</td><td className="cell-amount">{money(row.amount)}</td><td><span className={`badge ${status.cls}`}>{status.label}</span>{row.job_status&&<div className="cell-sub">AI: {row.job_status.replaceAll('_',' ')}</div>}</td><td><div className="qrpay-proceed-actions">{row.order_no?<button className="finance-order-link" onClick={()=>onOpenOrder?.(row.order_no!)}>{row.order_no}</button>:canManage?<button className="btn btn-primary btn-sm" onClick={()=>openMatch(row)}>Match Order</button>:row.whatsapp_link?<a className="btn btn-outline btn-sm" href={row.whatsapp_link} target="_blank" rel="noreferrer">WhatsApp</a>:<span className="cell-sub">Semak payment</span>}{!row.order_no&&canManage&&row.whatsapp_link&&<a className="btn btn-outline btn-sm" href={row.whatsapp_link} target="_blank" rel="noreferrer">WhatsApp</a>}</div></td></tr>})}</tbody></table>}</div>
      </div>
    </>}
    {matchRow&&<div className="qrpay-match-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)closeMatch();}}><section className="qrpay-match-dialog" role="dialog" aria-modal="true" aria-labelledby="qrpay-match-title">
      <div className="qrpay-match-head"><div><h2 id="qrpay-match-title">Match QRPay ke Order</h2><p>{matchRow.transaction_id} · {money(matchRow.amount)} · {matchRow.phone||'phone belum jumpa'}</p></div><button className="qrpay-match-close" onClick={closeMatch} aria-label="Close">×</button></div>
      <form className="qrpay-match-search" onSubmit={submitSearch}><input autoFocus value={matchQuery} onChange={(event)=>setMatchQuery(event.target.value)} placeholder="Order ID, phone atau nama customer"/><button className="btn btn-outline" disabled={matchLoading}>Cari</button></form>
      {matchError&&<div className="finance-alert"><b>Match error</b><span>{matchError}</span></div>}
      {matchLoading&&!candidateData?<div className="loading"><span className="spinner"/> Mencari order…</div>:candidateData&&<div className="qrpay-match-body">
        {candidateData.already_matched?<div className="empty"><div className="empty-title">Transaction ini sudah dipadankan.</div></div>:candidateData.candidates.length===0?<div className="empty"><div className="empty-title">Order tidak dijumpai.</div><div className="cell-sub">Masukkan Order ID penuh seperti IC260808-3730.</div></div>:<div className="qrpay-candidate-list">{candidateData.candidates.map((candidate)=>{const active=selected?.order_id===candidate.order_id;return <button type="button" key={candidate.order_id} disabled={!candidate.can_match} className={`qrpay-candidate ${active?'active':''}`} onClick={()=>setSelected(candidate)}><div><b>{candidate.order_no}</b><span>{candidate.customer_name} · {candidate.phone||'phone tiada'}</span></div><div><b>{money(candidate.total)}</b><span>{candidate.phone_match?'Phone sama':'Phone tidak sama'} · {dateTime(candidate.created_at)}</span></div>{candidate.blocked_reason&&<em>{candidate.blocked_reason}</em>}</button>})}</div>}
        {selected&&<div className="qrpay-match-confirm"><div className={Math.abs(Number(selected.amount_difference||0))>=0.01?'qrpay-match-warning':'qrpay-match-ok'}><b>QRPay {money(matchRow.amount)} → {selected.order_no} ({money(selected.total)})</b><span>{Math.abs(Number(selected.amount_difference||0))>=0.01?`Jumlah berbeza ${money(Math.abs(Number(selected.amount_difference)))}. Matching tidak mengubah total order.`:'Jumlah sama.'} {selected.phone_match?'Nombor telefon sepadan.':'Nombor telefon tidak sepadan.'}</span></div><button className="btn btn-primary" disabled={matchLoading||!selected.can_match} onClick={()=>void confirmMatch()}>{matchLoading?'Matching…':Math.abs(Number(selected.amount_difference||0))>=0.01?'Confirm Match Walaupun Jumlah Berbeza':'Confirm Match'}</button></div>}
      </div>}
    </section></div>}
  </div>;
}

function Metric({label,value,hint,cls}:{label:string;value:string;hint:string;cls:string}){return <div className={`stat-card ${cls}`}><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;}
