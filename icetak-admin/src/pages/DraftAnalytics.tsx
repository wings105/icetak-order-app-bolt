export type DraftReport = {
  period:{kind:'day'|'week'|'month';date:string;from:string;to:string;date_basis:'created'|'sent';timezone:string};
  summary:{total:number;sent:number;unsent:number;closed_sales:number;cancelled:number;pending:number;closed_all:number;cancelled_all:number;order_unpaid_all:number;closed_value:number;sent_pct:number|null;closed_pct:number|null;cancelled_pct:number|null;pending_pct:number|null};
  pagination:{offset:number;limit:number;total:number};
  options:{sources:string[];statuses:string[]};
  cancel_reasons:{code:string;label:string;count:number;sent_count:number;pct:number}[];
  sources:{source:string;total:number;sent:number;closed:number;cancelled:number;closed_pct:number|null}[];
  trend:{at:string;label:string;total:number;sent:number;closed:number;cancelled:number;pending:number}[];
};
export type DraftFilters = {period:'day'|'week'|'month';date:string;date_basis:'created'|'sent';state:string;status:string;source:string;payment_mode:string;delivery:string;reason:string;sort:string;offset:number};
export const percentage=(value:number|null|undefined)=>value==null?'—':`${Number(value).toFixed(1)}%`;
export const sourceLabel=(source:string)=>({chat_trigger:'WhatsApp / chat',pickup_trigger:'Pickup trigger',admin_manual:'Manual admin',qrpay_payment:'QRPay'}[source]||source.replaceAll('_',' '));
export const outcomeLabel=(outcome:string)=>({active:'Draft aktif',closed:'Closed sales',cancelled:'Cancelled',order_unpaid:'Order belum bayar'}[outcome]||outcome);
export const malaysiaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function moveDraftPeriod(date:string,period:DraftFilters['period'],direction:number){
  const d=new Date(`${date}T12:00:00Z`);
  if(period==='month'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+direction)}else d.setUTCDate(d.getUTCDate()+direction*(period==='week'?7:1));
  return d.toISOString().slice(0,10);
}

export function DraftMetrics({report,state,onState}:{report:DraftReport;state:string;onState:(value:string)=>void}){
  const s=report.summary;
  const tiles=[{label:'Jumlah draft',count:s.total,detail:`${s.unsent} belum dihantar`,state:'all'},
    {label:'Dihantar ke customer',count:s.sent,detail:`${percentage(s.sent_pct)} daripada semua draft`,state:'sent'},
    {label:'Closed sales',count:s.closed_sales,detail:`${percentage(s.closed_pct)} daripada dihantar`,state:'closed'},
    {label:'Cancelled selepas hantar',count:s.cancelled,detail:`${percentage(s.cancelled_pct)} daripada dihantar`,state:'cancelled'},
    {label:'Belum closed',count:s.pending,detail:`${percentage(s.pending_pct)} daripada dihantar`,state:'pending'}];
  return <div className="draft-report-metrics">{tiles.map(t=><button key={t.state} className={state===t.state?'active':''} onClick={()=>onState(state===t.state?'all':t.state)}><span>{t.label}</span><b>{t.count}</b><small>{t.detail}</small></button>)}</div>;
}

export function DraftGraphs({report,onReason,onState}:{report:DraftReport;onReason:(reason:string)=>void;onState:(state:string)=>void}){
  const s=report.summary,maxSent=Math.max(1,...report.trend.map(t=>t.sent));
  const outcomes=[{key:'closed',label:'Closed sales',n:s.closed_sales,p:s.closed_pct},{key:'cancelled',label:'Cancelled',n:s.cancelled,p:s.cancelled_pct},{key:'pending',label:'Belum closed',n:s.pending,p:s.pending_pct}];
  return <div className="draft-graphs">
    <section className="draft-chart-panel"><h2>Keputusan draft dihantar</h2><p>Daripada {s.sent} draft dihantar: closed + cancelled + belum closed = 100%.</p>
      {s.sent===0?<div className="draft-chart-empty">Tiada draft dihantar dalam filter ini.</div>:<div className="draft-outcome-bars">{outcomes.map(o=><button key={o.key} onClick={()=>onState(o.key==='pending'?'pending':o.key)}><span>{o.label}</span><div className="draft-bar-track"><i className={o.key} style={{width:`${o.p||0}%`}}/></div><b>{o.n} · {percentage(o.p)}</b></button>)}</div>}
      <small>{s.order_unpaid_all} order converted belum bayar · {s.closed_all} closed keseluruhan termasuk draft tanpa rekod hantar.</small>
    </section>
    <section className="draft-chart-panel"><h2>Sebab cancelled</h2><p>{s.cancelled_all} cancelled keseluruhan · % daripada semua cancelled dalam filter.</p>
      {report.cancel_reasons.length===0?<div className="draft-chart-empty">Tiada cancellation dalam filter ini.</div>:<div className="draft-reason-bars">{report.cancel_reasons.map(r=><button key={r.code} onClick={()=>onReason(r.code)} title="Tapis senarai mengikut sebab ini"><span>{r.label}<small>{r.sent_count} selepas dihantar</small></span><div className="draft-bar-track"><i className="cancelled" style={{width:`${r.pct}%`}}/></div><b>{r.count} · {percentage(r.pct)}</b></button>)}</div>}
    </section>
    <section className="draft-chart-panel draft-trend-panel"><h2>Trend draft dihantar</h2><p>{report.period.date_basis==='sent'?'Mengikut tarikh rekod hantar':'Mengikut tarikh draft dibuat'} · warna menunjukkan keputusan terkini bagi setiap draft.</p>
      <div className="draft-chart-legend"><span className="closed">Closed sales</span><span className="cancelled">Cancelled</span><span className="pending">Belum closed</span></div>
      <div className="draft-trend-scroll"><div className="draft-trend-bars" style={{gridTemplateColumns:`repeat(${report.trend.length},minmax(36px,1fr))`}}>{report.trend.map(t=><div key={t.at} className="draft-trend-column" title={`${t.label}: ${t.sent} dihantar, ${t.closed} closed, ${t.cancelled} cancelled, ${t.pending} belum closed`}><b>{t.sent||''}</b><div className="draft-trend-stack"><i className="pending" style={{height:`${t.pending/maxSent*150}px`}}/><i className="cancelled" style={{height:`${t.cancelled/maxSent*150}px`}}/><i className="closed" style={{height:`${t.closed/maxSent*150}px`}}/></div><span>{t.label}</span></div>)}</div></div>
      <details><summary>Lihat angka trend</summary><div className="draft-table-scroll"><table className="draft-report-table"><thead><tr><th>Tarikh / jam</th><th>Jumlah</th><th>Dihantar</th><th>Closed</th><th>Cancelled</th><th>Belum closed</th></tr></thead><tbody>{report.trend.map(t=><tr key={t.at}><td>{t.label}</td><td>{t.total}</td><td>{t.sent}</td><td>{t.closed}</td><td>{t.cancelled}</td><td>{t.pending}</td></tr>)}</tbody></table></div></details>
    </section>
    <section className="draft-chart-panel draft-source-panel"><h2>Conversion mengikut sumber</h2><div className="draft-table-scroll"><table className="draft-report-table"><thead><tr><th>Sumber</th><th>Jumlah</th><th>Dihantar</th><th>Closed</th><th>Cancelled</th><th>Closed %</th></tr></thead><tbody>{report.sources.length?report.sources.map(x=><tr key={x.source}><td>{sourceLabel(x.source)}</td><td>{x.total}</td><td>{x.sent}</td><td>{x.closed}</td><td>{x.cancelled}</td><td>{percentage(x.closed_pct)}</td></tr>):<tr><td colSpan={6}>Tiada draft dalam filter ini.</td></tr>}</tbody></table></div><small>Closed % = closed daripada draft dihantar bagi sumber tersebut.</small></section>
  </div>;
}
