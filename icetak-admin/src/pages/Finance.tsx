import { useEffect, useState } from 'react';
import { IconRefresh } from '../components/Icons';
import { supabase } from '../lib/supabase';
import './Finance.css';

type Tab = 'overview' | 'transactions' | 'reconciliation' | 'expenses' | 'shopee' | 'accounts' | 'reports' | 'webhooks';
type Account = { id:number; code:string; name:string; account_type:string; account_subtype:string|null; opening_balance:number|string; balance:number|string };
type Connection = { slug:string; name:string; source_type:string; is_active:boolean; last_event_at:string|null };
type Transaction = {
  id:number; direction:'in'|'out'; amount:number|string; currency:string; occurred_at:string; settled_at?:string|null;
  description:string|null; counterparty:string|null; bank_reference?:string|null; external_reference?:string|null;
  status:string; reconciliation_status:string; order_id:string|null; payment_session_id?:string|null; order_no?:string|null;
  account_code:string; account_name:string; classification_code:string|null; classification_name:string|null; source_count:number;
};
type ReconciliationCase = {
  id:number; case_type:string; status:string; primary_transaction_id:number|null; candidate_transaction_id:number|null;
  reason:string; confidence:number|string|null; details:Record<string,unknown>; created_at:string;
};
type Snapshot = {
  kpis:{month_in:number|string;month_out:number|string;review_transactions:number};
  accounts:Account[];
  connections:Connection[];
  reconciliation:ReconciliationCase[];
  recent_transactions:Transaction[];
  shopee:{orders:number;released:number|string;fees:number|string;pending:number};
  raw_event_status:Record<string,number>;
};
type Report = { from:string;to:string;income:number|string;expense:number|string;profit:number|string;lines:Array<{account_type:string;code:string;name:string;amount:number|string}> };
type Props = { canManage:boolean; onOpenOrder?:(orderNo:string)=>void };

const tabs:Array<{key:Tab;label:string}> = [
  {key:'overview',label:'Overview'}, {key:'transactions',label:'Transactions'}, {key:'reconciliation',label:'Reconciliation'},
  {key:'expenses',label:'Expenses'}, {key:'shopee',label:'Shopee'}, {key:'accounts',label:'Accounts'},
  {key:'reports',label:'P&L'}, {key:'webhooks',label:'Webhooks'},
];
const money=(value:number|string|null|undefined)=>`RM ${Number(value||0).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'—';

async function financeInvoke<T>(body:Record<string,unknown>):Promise<T>{
  const {data,error}=await supabase.functions.invoke('finance-admin',{body});
  if(error)throw new Error(error.message);
  if(!data?.success)throw new Error(data?.error||'Finance request failed');
  return data.data as T;
}

export default function Finance({canManage,onOpenOrder}:Props){
  const [tab,setTab]=useState<Tab>('overview');
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [rows,setRows]=useState<Transaction[]>([]);
  const [report,setReport]=useState<Report|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [direction,setDirection]=useState('');
  const [status,setStatus]=useState('');
  const firstOfMonth=new Date();firstOfMonth.setDate(1);
  const [from,setFrom]=useState(firstOfMonth.toISOString().slice(0,10));
  const [to,setTo]=useState(new Date().toISOString().slice(0,10));

  const loadSnapshot=async()=>{
    setLoading(true);setError(null);
    try{const next=await financeInvoke<Snapshot>({action:'snapshot'});setSnapshot(next);setRows(next.recent_transactions||[]);}
    catch(e){setError(e instanceof Error?e.message:'Finance failed to load');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void loadSnapshot();},[]);

  const loadTransactions=async()=>{
    setBusy('transactions');setError(null);
    try{
      const data=await financeInvoke<{rows:Transaction[]}>({action:'transactions',limit:500,query:query||null,direction:direction||null,status:status||null});
      setRows(data.rows||[]);
    }catch(e){setError(e instanceof Error?e.message:'Transactions failed to load');}
    finally{setBusy(null);}
  };
  const loadReport=async()=>{
    setBusy('report');setError(null);
    try{setReport(await financeInvoke<Report>({action:'report',from,to}));}
    catch(e){setError(e instanceof Error?e.message:'Report failed to load');}
    finally{setBusy(null);}
  };
  const runAction=async(key:string,body:Record<string,unknown>,confirmText?:string)=>{
    if(confirmText&&!window.confirm(confirmText))return;
    setBusy(key);setError(null);
    try{await financeInvoke(body);await loadSnapshot();}
    catch(e){setError(e instanceof Error?e.message:'Finance action failed');}
    finally{setBusy(null);}
  };
  const classify=async(transactionId:number,accountCode:string)=>{
    if(!accountCode)return;
    await runAction(`classify-${transactionId}`,{action:'classify',transaction_id:transactionId,account_code:accountCode},'Post semula transaksi menggunakan kategori ini?');
  };
  const openCases=snapshot?.reconciliation||[];
  const expenseAccounts=(snapshot?.accounts||[]).filter((a)=>a.account_type==='expense');
  const outgoing=rows.filter((r)=>r.direction==='out'&&r.status!=='void');
  const webhookBase=`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/finance-webhook`;
  const copy=async(value:string)=>{await navigator.clipboard.writeText(value);};

  if(loading&&!snapshot)return <div className="loading"><span className="spinner"/> Loading Finance…</div>;
  return <div className="fade-in finance-page">
    <div className="page-header"><div><h1 className="page-title">Finance</h1><p className="page-subtitle">Canonical bank feed, deduplication, reconciliation and double-entry ledger. Owner access only.</p></div><button className="btn btn-outline" onClick={()=>void loadSnapshot()}><IconRefresh size={16}/> Refresh</button></div>
    {error&&<div className="finance-alert"><b>Finance error</b><span>{error}</span></div>}
    <div className="finance-tabs">{tabs.map((item)=><button key={item.key} className={tab===item.key?'active':''} onClick={()=>setTab(item.key)}>{item.label}{item.key==='reconciliation'&&openCases.length>0?<span>{openCases.length}</span>:null}</button>)}</div>

    {tab==='overview'&&snapshot&&<>
      <div className="finance-metrics">
        <Metric label="Money In — Month" value={money(snapshot.kpis.month_in)} cls="green"/>
        <Metric label="Money Out — Month" value={money(snapshot.kpis.month_out)} cls="red"/>
        <Metric label="Net Movement" value={money(Number(snapshot.kpis.month_in)-Number(snapshot.kpis.month_out))} cls="blue"/>
        <Metric label="Needs Review" value={String(snapshot.kpis.review_transactions)} cls="amber"/>
      </div>
      <div className="grid-2">
        <Panel title="Cash & Wallet Accounts" subtitle="Opening balance + posted journal movement">
          <div className="finance-account-list">{snapshot.accounts.filter((a)=>a.account_type==='asset').map((a)=><div className="finance-account" key={a.id}><div><b>{a.name}</b><span>{a.code}</span></div><strong>{money(a.balance)}</strong></div>)}</div>
        </Panel>
        <Panel title="Source Health" subtitle="Last accepted event for each connection">
          <div className="finance-account-list">{snapshot.connections.map((c)=><div className="finance-account" key={c.slug}><div><b>{c.name}</b><span>{c.source_type}</span></div><div className="finance-connection"><i className={c.is_active?'online':'offline'}/><span>{c.last_event_at?dateTime(c.last_event_at):'Waiting for first event'}</span></div></div>)}</div>
        </Panel>
      </div>
      <TransactionTable rows={snapshot.recent_transactions.slice(0,20)} onOpenOrder={onOpenOrder}/>
    </>}

    {tab==='transactions'&&<>
      <div className="panel"><div className="panel-header finance-filter"><input placeholder="Reference, description, counterparty or order…" value={query} onChange={(e)=>setQuery(e.target.value)}/><select value={direction} onChange={(e)=>setDirection(e.target.value)}><option value="">All directions</option><option value="in">Money in</option><option value="out">Money out</option></select><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">All statuses</option><option value="posted">Posted</option><option value="review">Review</option><option value="confirmed">Bank confirmed</option><option value="possible_duplicate">Possible duplicate</option><option value="unmatched">Unmatched</option></select><button className="btn btn-primary" disabled={busy==='transactions'} onClick={()=>void loadTransactions()}>{busy==='transactions'?'Loading…':'Search'}</button></div></div>
      <TransactionTable rows={rows} onOpenOrder={onOpenOrder}/>
    </>}

    {tab==='reconciliation'&&<Panel title="Reconciliation Queue" subtitle="No possible duplicate is posted twice until it is resolved">
      {openCases.length===0?<Empty text="No open reconciliation cases."/>:<div className="finance-case-list">{openCases.map((c)=><div className="finance-case" key={c.id}><div><span className="badge badge-warning">{c.case_type.replaceAll('_',' ')}</span><h3>{c.reason}</h3><p>Transaction {c.primary_transaction_id||'—'} vs {c.candidate_transaction_id||'—'} · Confidence {c.confidence?Math.round(Number(c.confidence)*100):0}% · {dateTime(c.created_at)}</p></div>{canManage&&<div className="finance-actions"><button className="btn btn-confirm btn-sm" disabled={busy===`case-${c.id}`} onClick={()=>void runAction(`case-${c.id}`,{action:'resolve',case_id:c.id,resolution:'confirm_same'},'Gabungkan kedua-dua pemerhatian sebagai SATU transaksi?')}>Same transaction</button><button className="btn btn-outline btn-sm" onClick={()=>void runAction(`case-${c.id}`,{action:'resolve',case_id:c.id,resolution:'keep_separate'},'Sahkan kedua-duanya ialah transaksi berasingan?')}>Keep separate</button><button className="btn btn-ghost btn-sm" onClick={()=>void runAction(`case-${c.id}`,{action:'resolve',case_id:c.id,resolution:'ignore'})}>Ignore</button></div>}</div>)}</div>}
    </Panel>}

    {tab==='expenses'&&<Panel title="Expense Classification" subtitle="Outgoing transactions start in Unclassified Expense until categorized">
      {outgoing.length===0?<Empty text="No outgoing transactions yet. CIMB webhook will populate this view."/>:<div className="table-wrap"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Current</th><th>Post to account</th></tr></thead><tbody>{outgoing.map((t)=><tr key={t.id}><td className="cell-sub">{dateTime(t.occurred_at)}</td><td><div className="cell-name">{t.description||'Outgoing transaction'}</div><div className="cell-sub">{t.counterparty||t.external_reference||'—'}</div></td><td className="cell-amount">{money(t.amount)}</td><td>{t.classification_name||'Unclassified Expense'}</td><td><select disabled={!canManage||busy===`classify-${t.id}`} value={t.classification_code||''} onChange={(e)=>void classify(t.id,e.target.value)}><option value="">Choose category…</option>{expenseAccounts.map((a)=><option value={a.code} key={a.code}>{a.name}</option>)}</select></td></tr>)}</tbody></table></div>}
    </Panel>}

    {tab==='shopee'&&snapshot&&<>
      <div className="finance-metrics">
        <Metric label="Financial Orders" value={String(snapshot.shopee.orders)} cls="blue"/>
        <Metric label="Released to Wallet" value={money(snapshot.shopee.released)} cls="green"/>
        <Metric label="Platform Fees" value={money(snapshot.shopee.fees)} cls="red"/>
        <Metric label="Awaiting Enrichment" value={String(snapshot.shopee.pending)} cls="amber"/>
      </div>
      <Panel title="Shopee Wallet & Escrow" subtitle="Release, fee, ads, loan and withdrawal remain separate movements">
        <div className="finance-info"><div><b>Shadow settlement sync</b><p>Reads existing marketplace financial enrichment without counting bank withdrawals as new sales.</p></div>{canManage&&<button className="btn btn-primary" disabled={busy==='shopee'} onClick={()=>void runAction('shopee',{action:'sync_shopee'})}>{busy==='shopee'?'Syncing…':'Sync Shopee Financials'}</button>}</div>
      </Panel>
    </>}

    {tab==='accounts'&&snapshot&&<Panel title="Chart of Accounts" subtitle="Private double-entry accounts">
      <div className="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Subtype</th><th>Opening</th><th>System Balance</th></tr></thead><tbody>{snapshot.accounts.map((a)=><tr key={a.id}><td className="cell-id">{a.code}</td><td className="cell-name">{a.name}</td><td><span className="tag tag-neutral">{a.account_type}</span></td><td className="cell-sub">{a.account_subtype||'—'}</td><td className="cell-amount">{money(a.opening_balance)}</td><td className="cell-amount">{money(a.balance)}</td></tr>)}</tbody></table></div>
    </Panel>}

    {tab==='reports'&&<>
      <div className="panel"><div className="panel-header finance-report-filter"><div className="form-field"><label>From</label><input type="date" value={from} onChange={(e)=>setFrom(e.target.value)}/></div><div className="form-field"><label>To</label><input type="date" value={to} onChange={(e)=>setTo(e.target.value)}/></div><button className="btn btn-primary" disabled={busy==='report'} onClick={()=>void loadReport()}>{busy==='report'?'Calculating…':'Generate P&L'}</button></div></div>
      {report&&<><div className="finance-metrics"><Metric label="Income" value={money(report.income)} cls="green"/><Metric label="Expenses" value={money(report.expense)} cls="red"/><Metric label="Profit / Loss" value={money(report.profit)} cls={Number(report.profit)>=0?'blue':'amber'}/></div><Panel title="Profit & Loss Lines" subtitle={`${report.from} — ${report.to}`}><div className="table-wrap"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Amount</th></tr></thead><tbody>{report.lines.map((line)=><tr key={line.code}><td className="cell-id">{line.code}</td><td>{line.name}</td><td>{line.account_type}</td><td className="cell-amount">{money(line.account_type==='expense'?-Number(line.amount):line.amount)}</td></tr>)}</tbody></table></div></Panel></>}
    </>}

    {tab==='webhooks'&&snapshot&&<Panel title="Finance Webhook Endpoints" subtitle="Use POST JSON and the x-icetak-webhook-secret header. Secrets are never shown in this dashboard.">
      <div className="finance-webhook-list">{snapshot.connections.filter((c)=>['qrpay-in','cimb-out','bank-statement'].includes(c.slug)).map((c)=>{const url=`${webhookBase}/${c.slug}`;return <div className="finance-webhook" key={c.slug}><div><b>{c.name}</b><code>{url}</code><span>{c.last_event_at?`Last event: ${dateTime(c.last_event_at)}`:'Waiting for first event'}</span></div><button className="btn btn-outline btn-sm" onClick={()=>void copy(url)}>Copy URL</button></div>})}</div>
      <div className="finance-payload-example"><b>Minimum JSON fields</b><pre>{JSON.stringify({transaction_id:'unique-reference',amount:100,direction:'in',transaction_date:'2026-08-08T18:30:00+08:00',description:'Bank description',counterparty:'Customer or supplier'},null,2)}</pre></div>
    </Panel>}
  </div>;
}

function Metric({label,value,cls}:{label:string;value:string;cls:string}){return <div className={`stat-card ${cls}`}><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>;}
function Panel({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){return <div className="panel"><div className="panel-header"><div><div className="panel-title">{title}</div><div className="panel-subtitle">{subtitle}</div></div></div>{children}</div>;}
function Empty({text}:{text:string}){return <div className="empty"><div className="empty-title">{text}</div></div>;}
function TransactionTable({rows,onOpenOrder}:{rows:Transaction[];onOpenOrder?:Props['onOpenOrder']}){return <div className="panel"><div className="panel-header"><div><div className="panel-title">Canonical Transactions</div><div className="panel-subtitle">{rows.length} records · one transaction can have multiple source observations</div></div></div><div className="table-wrap">{rows.length===0?<Empty text="No canonical transactions yet."/>:<table><thead><tr><th>Date</th><th>Flow</th><th>Description</th><th>Account</th><th>Amount</th><th>Sources</th><th>Status</th><th>Order</th></tr></thead><tbody>{rows.map((t)=><tr key={t.id} className="row-hover"><td className="cell-sub">{dateTime(t.occurred_at)}</td><td><span className={`badge ${t.direction==='in'?'badge-success':'badge-error'}`}>{t.direction==='in'?'Money in':'Money out'}</span></td><td><div className="cell-name">{t.description||'Transaction'}</div><div className="cell-sub">{t.counterparty||t.bank_reference||t.external_reference||'—'}</div></td><td><div>{t.account_name}</div><div className="cell-sub">{t.classification_name||'Unclassified'}</div></td><td className="cell-amount">{money(t.amount)}</td><td><span className="tag tag-neutral">{t.source_count}</span></td><td><span className={`badge ${t.status==='review'||t.reconciliation_status==='possible_duplicate'?'badge-warning':t.status==='void'?'badge-neutral':'badge-success'}`}>{t.reconciliation_status.replaceAll('_',' ')}</span></td><td>{t.order_no?<button className="finance-order-link" onClick={()=>onOpenOrder?.(t.order_no!)}>{t.order_no}</button>:'—'}</td></tr>)}</tbody></table>}</div></div>;}
