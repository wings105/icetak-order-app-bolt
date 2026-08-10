import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './ClickUpQueue.css';

type QueueStatus = 'attention'|'waiting'|'processing'|'retrying'|'partial'|'failed'|'held'|'success'|'archived'|'all';
type Summary = { all?:number; attention?:number; waiting?:number; processing?:number; retrying?:number; partial?:number; failed?:number; held?:number; success?:number; archived?:number; successToday?:number };
type ComponentRow = { componentId:string; label?:string; type?:string; clickupTaskId?:string|null; clickupStatus?:string|null; linkSource?:string|null; taskUrl?:string|null };
type QueueRow = {
  orderDbId:string; orderNo:string; customerName?:string; customerPhone?:string; dateNeed?:string|null; source?:string; orderCreatedAt?:string|null; publicToken?:string;
  outboxId?:string|null; outboxStatus?:string; status:string; attempts?:number; lastError?:string; queuedAt?:string|null; lockedAt?:string|null; nextAttemptAt?:string|null; processedAt?:string|null;
  componentsTotal?:number; componentsLinked?:number; componentsMissing?:number; componentSummary?:string; components?:ComponentRow[];
};
type QueueResponse = { summary?:Summary; rows?:QueueRow[]; pagination?:{page:number;pageSize:number;total:number;totalPages:number}; serverTime?:string };
type DetailComponent = ComponentRow & { orderItemId?:string; workflow?:string; reviewRequired?:boolean; reviewStatus?:string; progressPercent?:number; previewUrl?:string|null; item?:{title?:string;qty?:number;size?:string;style?:string;wording?:string;price?:number} };
type Detail = {
  order?: { id?:string; orderNo?:string; customerName?:string; customerPhone?:string; dateNeed?:string; source?:string; status?:string; adminStatus?:string; productionApproved?:boolean; publicToken?:string; adminOrderLink?:string };
  outbox?: { id?:string; status?:string; attempts?:number; lastError?:string; nextAttemptAt?:string; lockedAt?:string; processedAt?:string; queuedAt?:string; payload?:unknown } | null;
  components?: DetailComponent[];
  events?: Array<{id?:string;kind?:string;statusFrom?:string;statusTo?:string;attempts?:number;actor?:string;detail?:Record<string,unknown>;at?:string}>;
  canonicalPayload?: unknown;
};

type Props = { permissions?:string[]; onOpenOrder?:(orderNo:string)=>void };

const FILTERS:Array<{key:QueueStatus;label:string;count?:keyof Summary}> = [
  {key:'attention',label:'Attention',count:'attention'}, {key:'waiting',label:'Waiting',count:'waiting'}, {key:'processing',label:'Processing',count:'processing'},
  {key:'retrying',label:'Retry',count:'retrying'}, {key:'partial',label:'Partial',count:'partial'}, {key:'failed',label:'Failed',count:'failed'},
  {key:'held',label:'Held',count:'held'}, {key:'success',label:'Success',count:'success'}, {key:'archived',label:'Archived',count:'archived'}, {key:'all',label:'All',count:'all'},
];
const money=(v:unknown)=>`RM ${Number(v||0).toFixed(2)}`;
const dt=(v?:string|null)=>v?new Date(v).toLocaleString('en-MY',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const date=(v?:string|null)=>v?new Date(`${String(v).slice(0,10)}T00:00:00`).toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'}):'—';
const digits=(v:unknown)=>String(v||'').replace(/\D/g,'');

function statusMeta(status:string){
  const s=String(status||'').toLowerCase();
  if(s==='success') return {label:'SUCCESS',tone:'success'};
  if(s==='processing') return {label:'PROCESSING',tone:'info'};
  if(s==='waiting') return {label:'WAITING',tone:'neutral'};
  if(s==='retrying') return {label:'RETRYING',tone:'warning'};
  if(s==='partial') return {label:'PARTIAL',tone:'warning'};
  if(s==='held') return {label:'HELD',tone:'warning'};
  if(s==='archived') return {label:'ARCHIVED',tone:'neutral'};
  if(s==='stale') return {label:'STALE',tone:'danger'};
  if(s==='missing_queue') return {label:'MISSING QUEUE',tone:'danger'};
  if(s==='data_problem') return {label:'DATA PROBLEM',tone:'danger'};
  return {label:'FAILED',tone:'danger'};
}

export default function ClickUpQueue({ permissions=[], onOpenOrder }:Props){
  const [status,setStatus]=useState<QueueStatus>('attention');
  const [query,setQuery]=useState('');
  const [page,setPage]=useState(1);
  const [pageSize,setPageSize]=useState(50);
  const [rows,setRows]=useState<QueueRow[]>([]);
  const [summary,setSummary]=useState<Summary>({});
  const [pagination,setPagination]=useState({page:1,pageSize:50,total:0,totalPages:1});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [detailRef,setDetailRef]=useState('');
  const [detail,setDetail]=useState<Detail|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [busy,setBusy]=useState('');
  const canEdit=permissions.includes('edit_order')||permissions.includes('quick_arrange');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    const {data,error:rpcError}=await supabase.rpc('icetak_admin_clickup_queue',{p_status:status,p_query:query,p_page:page,p_page_size:pageSize});
    setLoading(false);
    if(rpcError){setError(rpcError.message);return;}
    const result=(data||{}) as QueueResponse;
    setRows(result.rows||[]);setSummary(result.summary||{});setPagination(result.pagination||{page,pageSize,total:0,totalPages:1});
  },[status,query,page,pageSize]);

  const loadDetail=useCallback(async(ref:string)=>{
    if(!ref){setDetail(null);return;}
    setDetailLoading(true);setError('');
    const {data,error:rpcError}=await supabase.rpc('icetak_admin_clickup_queue_detail',{p_order_ref:ref});
    setDetailLoading(false);
    if(rpcError){setError(rpcError.message);setDetail(null);return;}
    setDetail((data||null) as Detail|null);
  },[]);

  useEffect(()=>{const t=window.setTimeout(()=>void load(),180);return()=>window.clearTimeout(t);},[load]);
  useEffect(()=>{const t=window.setInterval(()=>void load(),30000);return()=>window.clearInterval(t);},[load]);
  useEffect(()=>{if(detailRef) void loadDetail(detailRef);},[detailRef,loadDetail]);
  useEffect(()=>{if(!notice)return;const t=window.setTimeout(()=>setNotice(''),3000);return()=>window.clearTimeout(t);},[notice]);

  const retry=async(row:Pick<QueueRow,'orderDbId'|'orderNo'>)=>{
    if(!canEdit){setError('Permission edit_order / quick_arrange required.');return;}
    if(!window.confirm(`Reopen ${row.orderNo} untuk Activepieces? Sistem hanya akan create component yang masih belum ada ClickUp task ID.`)) return;
    setBusy(row.orderDbId);setError('');
    const {error:rpcError}=await supabase.rpc('icetak_admin_clickup_queue_retry',{p_order_id:row.orderDbId});
    setBusy('');
    if(rpcError){setError(rpcError.message);return;}
    setNotice(`${row.orderNo}: reopened untuk AP.`);await load();if(detailRef)await loadDetail(row.orderDbId);
  };

  const linkExisting=async(component:DetailComponent)=>{
    const ref=window.prompt('Paste ClickUp Task ID atau URL',component.clickupTaskId||'');
    if(!ref?.trim()) return;
    setBusy(component.componentId);setError('');
    const {error:rpcError}=await supabase.rpc('icetak_admin_link_clickup_component',{p_component_id:component.componentId,p_task_ref:ref.trim()});
    setBusy('');
    if(rpcError){setError(rpcError.message);return;}
    setNotice('ClickUp task linked.');if(detailRef)await loadDetail(detailRef);await load();
  };

  const copyPayload=async()=>{
    if(!detail?.canonicalPayload)return;
    await navigator.clipboard.writeText(JSON.stringify(detail.canonicalPayload,null,2));setNotice('Canonical AP payload copied.');
  };

  const selected=useMemo(()=>rows.find(r=>r.orderDbId===detailRef||r.orderNo===detailRef),[rows,detailRef]);
  return <div className="cuq-page fade-in">
    <div className="page-header cuq-header"><div><div className="page-label">Production Automation</div><h1 className="page-title">ClickUp Queue</h1><p className="page-subtitle">Activepieces → ClickUp task creation · component-safe retry · live diagnostics</p></div><button className="btn btn-outline" onClick={()=>void load()}>Refresh</button></div>
    <div className="cuq-metrics">
      <Metric label="Attention" value={summary.attention} tone={Number(summary.attention||0)>0?'danger':'neutral'}/><Metric label="Processing" value={summary.processing} tone="info"/><Metric label="Waiting" value={summary.waiting} tone="neutral"/><Metric label="Retry" value={summary.retrying} tone="warning"/><Metric label="Failed" value={summary.failed} tone={Number(summary.failed||0)>0?'danger':'neutral'}/><Metric label="Success Today" value={summary.successToday} tone="success"/>
    </div>
    {notice&&<div className="cuq-notice success">✓ {notice}</div>}{error&&<div className="cuq-notice error">{error}</div>}
    <div className="panel cuq-panel">
      <div className="cuq-filterbar">{FILTERS.map(f=><button key={f.key} className={`cuq-chip ${status===f.key?'active':''}`} onClick={()=>{setStatus(f.key);setPage(1);}}>{f.label}<b>{Number(f.count?summary[f.count]:0)}</b></button>)}</div>
      <div className="cuq-toolbar"><input value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="Search order, customer, component, error..."/><span className="cuq-live">Auto refresh 30s</span></div>
      <div className="table-wrap">
        {loading?<div className="loading"><span className="spinner"/> Loading ClickUp queue...</div>:rows.length===0?<div className="empty"><div className="empty-title">Queue clear</div><p>No records for this filter.</p></div>:<table className="cuq-table"><thead><tr><th>Order</th><th>Queue</th><th>Components</th><th>ClickUp</th><th>Timing</th><th>Error</th><th>Action</th></tr></thead><tbody>{rows.map(row=><QueueTableRow key={row.orderDbId} row={row} busy={busy===row.orderDbId} canEdit={canEdit} onView={()=>{setDetailRef(row.orderDbId);setDetail(null);}} onRetry={()=>void retry(row)} onOpenOrder={()=>onOpenOrder?.(row.orderNo)}/>)}</tbody></table>}
      </div>
      <div className="cuq-pagination"><span>Showing {pagination.total?(pagination.page-1)*pagination.pageSize+1:0}–{Math.min(pagination.page*pagination.pageSize,pagination.total)} of <b>{pagination.total}</b></span><div><select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}><option value={25}>25 / page</option><option value={50}>50 / page</option><option value={100}>100 / page</option></select><button className="btn btn-outline btn-sm" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><span>Page {pagination.page}/{pagination.totalPages}</span><button className="btn btn-outline btn-sm" disabled={page>=pagination.totalPages} onClick={()=>setPage(p=>Math.min(pagination.totalPages,p+1))}>Next</button></div></div>
    </div>
    {detailRef&&<QueueDrawer detail={detail} loading={detailLoading} fallback={selected} busy={busy} canEdit={canEdit} onClose={()=>{setDetailRef('');setDetail(null);}} onRetry={()=>detail?.order?.id&&void retry({orderDbId:detail.order.id,orderNo:detail.order.orderNo||detail.order.id})} onLink={c=>void linkExisting(c)} onCopyPayload={()=>void copyPayload()} onOpenOrder={()=>detail?.order?.orderNo&&onOpenOrder?.(detail.order.orderNo)}/>} 
  </div>;
}

function QueueTableRow({row,busy,canEdit,onView,onRetry,onOpenOrder}:{row:QueueRow;busy:boolean;canEdit:boolean;onView:()=>void;onRetry:()=>void;onOpenOrder:()=>void}){
  const meta=statusMeta(row.status);const retryable=['failed','stale','data_problem','missing_queue','partial','held'].includes(row.status);
  return <tr><td><button className="cuq-order" onClick={onView}>{row.orderNo}</button><div className="cuq-sub">{row.customerName||'—'} · {row.customerPhone||'—'}</div><div className="cuq-sub">Need {date(row.dateNeed)} · {row.source||'—'}</div></td><td><span className={`cuq-status ${meta.tone}`}>{meta.label}</span><div className="cuq-sub">Outbox: {row.outboxStatus||'—'} · attempt {row.attempts||0}</div></td><td><b>{row.componentsLinked||0}/{row.componentsTotal||0} linked</b><div className="cuq-sub">{row.componentSummary||'—'}</div>{Number(row.componentsMissing||0)>0&&<span className="cuq-missing">{row.componentsMissing} missing</span>}</td><td><div className="cuq-tasklinks">{(row.components||[]).filter(c=>c.clickupTaskId).slice(0,3).map(c=><a key={c.componentId} href={c.taskUrl||`https://app.clickup.com/t/3747262/${c.clickupTaskId}`} target="_blank" rel="noreferrer">{c.clickupTaskId}</a>)}{!(row.components||[]).some(c=>c.clickupTaskId)&&<span className="cuq-sub">No task ID yet</span>}</div></td><td><div>Queued {dt(row.queuedAt)}</div><div className="cuq-sub">Claimed {dt(row.lockedAt)}</div><div className="cuq-sub">Next {dt(row.nextAttemptAt)}</div></td><td className="cuq-errorcell">{row.lastError||'—'}</td><td><div className="cuq-actions"><button className="btn btn-outline btn-sm" onClick={onView}>View</button>{retryable&&<button className="btn btn-primary btn-sm" disabled={busy||!canEdit} onClick={onRetry}>{busy?'Working…':row.status==='held'?'Release':'Retry Missing'}</button>}<button className="btn btn-ghost btn-sm" onClick={onOpenOrder}>Order</button></div></td></tr>;
}

function QueueDrawer({detail,loading,fallback,busy,canEdit,onClose,onRetry,onLink,onCopyPayload,onOpenOrder}:{detail:Detail|null;loading:boolean;fallback?:QueueRow;busy:string;canEdit:boolean;onClose:()=>void;onRetry:()=>void;onLink:(c:DetailComponent)=>void;onCopyPayload:()=>void;onOpenOrder:()=>void}){
  const [tab,setTab]=useState<'overview'|'payload'|'timeline'>('overview');const order=detail?.order;const outbox=detail?.outbox;
  return <div className="cuq-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><aside className="cuq-drawer">{loading||!detail?<div className="loading"><span className="spinner"/> Loading queue detail...</div>:<><header><div><div className="page-label">ClickUp Queue Detail</div><h2>{order?.orderNo||fallback?.orderNo}</h2><div className="cuq-sub">{order?.customerName||fallback?.customerName} · {order?.customerPhone||fallback?.customerPhone}</div></div><button onClick={onClose}>×</button></header><nav><button className={tab==='overview'?'active':''} onClick={()=>setTab('overview')}>Overview</button><button className={tab==='payload'?'active':''} onClick={()=>setTab('payload')}>AP Payload</button><button className={tab==='timeline'?'active':''} onClick={()=>setTab('timeline')}>Timeline</button></nav><div className="cuq-drawerbody">
    {tab==='overview'&&<><section className="cuq-card"><h3>Queue State</h3><div className="cuq-kvs"><KV k="Outbox" v={outbox?.status||'—'}/><KV k="Attempts" v={String(outbox?.attempts||0)}/><KV k="Queued" v={dt(outbox?.queuedAt)}/><KV k="Claimed" v={dt(outbox?.lockedAt)}/><KV k="Next Attempt" v={dt(outbox?.nextAttemptAt)}/><KV k="Last Error" v={outbox?.lastError||'—'}/></div><div className="cuq-actions"><button className="btn btn-outline btn-sm" onClick={onOpenOrder}>Open Order</button>{canEdit&&<button className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={onRetry}>Retry Missing</button>}</div></section><section className="cuq-card"><h3>Components</h3>{(detail.components||[]).map(c=><div className="cuq-component" key={c.componentId}><div><b>{c.label||'Component'}</b><span>{c.item?.title||c.type||'—'} · {c.item?.size||'—'} · {c.item?.style||'—'} · {money(c.item?.price)}</span><span>Component {c.componentId}</span></div><div>{c.clickupTaskId?<><span className="cuq-status success">LINKED</span><a href={c.taskUrl||`https://app.clickup.com/t/3747262/${c.clickupTaskId}`} target="_blank" rel="noreferrer">{c.clickupTaskId}</a></>:<><span className="cuq-status warning">NOT LINKED</span>{canEdit&&<button className="btn btn-outline btn-sm" disabled={busy===c.componentId} onClick={()=>onLink(c)}>Link Existing</button>}</>}</div></div>)}</section></>}
    {tab==='payload'&&<section className="cuq-card"><div className="cuq-cardhead"><h3>Canonical Activepieces Payload</h3><button className="btn btn-outline btn-sm" onClick={onCopyPayload}>Copy JSON</button></div><p className="cuq-sub">Claim function refreshes this payload immediately before AP receives the job. Only components without ClickUp IDs are included under <code>components</code>.</p><pre className="cuq-json">{JSON.stringify(detail.canonicalPayload,null,2)}</pre></section>}
    {tab==='timeline'&&<section className="cuq-card"><h3>Queue Timeline</h3>{(detail.events||[]).length?(detail.events||[]).map(e=><div className="cuq-event" key={e.id}><i/><div><b>{String(e.kind||'event').replaceAll('_',' ')}</b><span>{dt(e.at)} · {e.statusFrom||'—'} → {e.statusTo||'—'}{e.attempts!=null?` · attempt ${e.attempts}`:''}</span>{e.detail&&<details><summary>Detail</summary><pre>{JSON.stringify(e.detail,null,2)}</pre></details>}</div></div>):<p className="cuq-sub">No queue events recorded yet. New claims/retries/task links are audited from now on.</p>}</section>}
  </div><footer><button className="btn btn-outline btn-sm" onClick={onClose}>Close</button></footer></>}</aside></div>;
}
function Metric({label,value,tone}:{label:string;value?:number;tone:string}){return <div className={`cuq-metric ${tone}`}><span>{label}</span><b>{Number(value||0)}</b></div>}
function KV({k,v}:{k:string;v:string}){return <div className="cuq-kv"><span>{k}</span><b>{v}</b></div>}
