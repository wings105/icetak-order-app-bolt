import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh } from '../components/Icons';

type Session = {
  id: string;
  order_id: string | null;
  order_token: string | null;
  transaction_id: string | null;
  status: string | null;
  base_amount: number | string | null;
  discount: number | string | null;
  expected_amount: number | string | null;
  created_at: string;
  submitted_at: string | null;
  matched_at: string | null;
  expires_at: string | null;
  receipt_path: string | null;
  receipt_name: string | null;
  orders: { order_no: string | null; order_id: string | null } | null;
};

type Props = { onOpenOrder?: (orderNo: string) => void };
type StatusFilter = 'all' | 'matched' | 'submitted' | 'pending' | 'failed' | 'expired';

const statusTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'matched' || v === 'paid') return { label: 'Matched', cls: 'badge-success' };
  if (v === 'submitted' || v === 'receipt_submitted' || v === 'pending_review') return { label: 'Submitted', cls: 'badge-info' };
  if (v === 'expired' || v === 'superseded') return { label: v, cls: 'badge-neutral' };
  if (v === 'failed' || v === 'rejected') return { label: v, cls: 'badge-error' };
  return { label: v || 'pending', cls: 'badge-warning' };
};

function statusBucket(value: string | null): StatusFilter {
  const v=(value||'').toLowerCase();
  if(['matched','paid'].includes(v))return 'matched';
  if(['submitted','receipt_submitted','pending_review'].includes(v))return 'submitted';
  if(['failed','rejected'].includes(v))return 'failed';
  if(['expired','superseded'].includes(v))return 'expired';
  return 'pending';
}

export default function Payments({ onOpenOrder }: Props) {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter,setFilter]=useState<StatusFilter>('all');
  const [query,setQuery]=useState('');

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('id, order_id, order_token, transaction_id, status, base_amount, discount, expected_amount, created_at, submitted_at, matched_at, expires_at, receipt_path, receipt_name, orders(order_no,order_id)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) setErr(error.message); else setRows((data as unknown as Session[]) || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const totals = useMemo(()=>rows.reduce((acc,r)=>{
    const amt=Number(r.expected_amount||0); acc.count+=1;
    const b=statusBucket(r.status); if(b==='matched')acc.paid+=amt; else if(b==='submitted')acc.submitted+=amt; else if(b==='pending')acc.pending+=amt;
    return acc;
  },{count:0,paid:0,submitted:0,pending:0}),[rows]);

  const filtered=useMemo(()=>rows.filter((r)=>{
    if(filter!=='all'&&statusBucket(r.status)!==filter)return false;
    const q=query.trim().toLowerCase(); if(!q)return true;
    const orderNo=r.orders?.order_no||r.orders?.order_id||'';
    return [orderNo,r.transaction_id,r.status,r.receipt_name].some((v)=>String(v||'').toLowerCase().includes(q));
  }),[rows,filter,query]);

  return <div className="fade-in">
    <div className="page-header"><div><h1 className="page-title">Payments Center</h1><p className="page-subtitle">Payment session ledger. Verification actions live in Orders / Quick Order only.</p></div><button className="btn btn-outline" onClick={()=>void load()}><IconRefresh size={16}/> Refresh</button></div>
    <div className="stats-grid"><Metric label="Matched" value={`RM ${totals.paid.toFixed(2)}`} hint="Confirmed sessions"/><Metric label="Submitted" value={`RM ${totals.submitted.toFixed(2)}`} hint="Awaiting reconciliation"/><Metric label="Pending" value={`RM ${totals.pending.toFixed(2)}`} hint="Awaiting payment"/><Metric label="Sessions" value={String(totals.count)} hint="Recent 200"/></div>
    <div className="panel"><div className="panel-header" style={{gap:10,flexWrap:'wrap'}}><div><div className="panel-title">Payment Sessions</div><div className="panel-subtitle">{filtered.length} daripada {rows.length} records</div></div><div style={{display:'flex',gap:8,marginLeft:'auto',flexWrap:'wrap'}}><input placeholder="Order, transaction, receipt..." value={query} onChange={(e)=>setQuery(e.target.value)} /><select value={filter} onChange={(e)=>setFilter(e.target.value as StatusFilter)}><option value="all">All statuses</option><option value="matched">Matched</option><option value="submitted">Submitted</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="expired">Expired</option></select></div></div>
      <div className="table-wrap">{loading?<div className="loading"><span className="spinner"/> Loading…</div>:err?<div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>:<table><thead><tr><th>Order</th><th>Transaction</th><th>Base</th><th>Discount</th><th>Expected</th><th>Status</th><th>Receipt</th><th>Created</th><th>Matched</th></tr></thead><tbody>{filtered.map((r)=>{const st=statusTag(r.status);const orderNo=r.orders?.order_no||r.orders?.order_id||'';return <tr key={r.id} className="row-hover"><td>{orderNo?<button style={{color:'var(--primary)',fontWeight:800}} onClick={()=>onOpenOrder?.(orderNo)}>{orderNo}</button>:<span className="cell-sub">{r.order_id?r.order_id.slice(0,8):'—'}</span>}</td><td className="cell-sub">{r.transaction_id||'—'}</td><td className="cell-amount">RM {Number(r.base_amount||0).toFixed(2)}</td><td className="cell-amount">RM {Number(r.discount||0).toFixed(2)}</td><td className="cell-amount">RM {Number(r.expected_amount||0).toFixed(2)}</td><td><span className={`badge ${st.cls}`}>{st.label}</span></td><td>{r.receipt_path?<div><span className="tag tag-ready">Uploaded</span><div className="cell-sub">{r.receipt_name||r.receipt_path.split('/').pop()}</div></div>:<span className="tag tag-neutral">None</span>}</td><td className="cell-sub">{new Date(r.created_at).toLocaleString()}</td><td className="cell-sub">{r.matched_at?new Date(r.matched_at).toLocaleString():'—'}</td></tr>})}</tbody></table>}</div>
    </div>
  </div>;
}

function Metric({label,value,hint}:{label:string;value:string;hint:string}){return <div className="stat-card ready"><div className="stat-label">{label}</div><div className="stat-value" style={{fontSize:value.length>12?22:28}}>{value}</div><div className="stat-hint">{hint}</div></div>;}
