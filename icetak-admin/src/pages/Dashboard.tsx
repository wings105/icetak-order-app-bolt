import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { IconPlus } from '../components/Icons';
import { Bars, OrdersChart } from '../components/command-center/Charts';
import SalesPanel from '../components/command-center/SalesPanel';
import WhatsAppShortcuts from '../components/command-center/WhatsAppShortcuts';
import DeliveryIcon from '../components/command-center/DeliveryIcon';
import { adminHref, dateTime, money, number, stages } from '../components/command-center/contracts';
import type { Breakdown, Snapshot } from '../components/command-center/contracts';
import './Dashboard.css';
type Props={onOpenFocus?:()=>void;adminOrders?:unknown[];onQuickOrder?:()=>void;onOpenOrder?:(reference:string)=>void};
type Tab='overview'|'sales'|'orders'|'shipping'|'finance';
const tabs:[Tab,string][]=[['overview','Ringkasan'],['sales','Sales & Chat'],['orders','Orders & Production'],['shipping','Shipping'],['finance','Finance & Health']];
const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function before(value:string,n:number){const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);}
function Copy({value}:{value:string}){const [notice,setNotice]=useState('');return <button className="cc-copy" aria-label={`Salin ${value}`} title={notice||'Salin order ID'} onClick={async()=>{try{await navigator.clipboard.writeText(value);setNotice('Disalin');}catch{setNotice('Gagal salin');}}}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg><span className="cc-sr" role="status">{notice}</span></button>;}
function Panel({title,hint,children,full=false,action}:{title:string;hint?:string;children:ReactNode;full?:boolean;action?:ReactNode}){return <section className={`cc-panel ${full?'cc-full':''}`}><div className="cc-panel-head"><div><h2>{title}</h2>{hint&&<p>{hint}</p>}</div>{action}</div>{children}</section>;}
function Metric({label,value,hint,href,accent=false}:{label:string;value:ReactNode;hint:string;href?:string;accent?:boolean}){const content=<><span>{label}</span><strong>{value}</strong><small>{hint}</small></>;return href?<a className={`cc-metric ${accent?'accent':''}`} href={href}>{content}</a>:<div className={`cc-metric ${accent?'accent':''}`}>{content}</div>;}
function BreakdownPanel({title,hint,rows,color,onSelect}:{title:string;hint:string;rows:Breakdown[];color?:string;onSelect?:(r:Breakdown)=>void}){return <Panel title={title} hint={hint}><Bars rows={rows} color={color} onSelect={onSelect}/></Panel>;}
export default function Dashboard({onQuickOrder,onOpenOrder,onOpenFocus}:Props){
 const [tab,setTab]=useState<Tab>('overview'),[preset,setPreset]=useState('today'),[from,setFrom]=useState(day),[to,setTo]=useState(day),[source,setSource]=useState('all');
 const [data,setData]=useState<Snapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[auto,setAuto]=useState(false);
 const [focusType,setFocusType]=useState('all'),[detail,setDetail]=useState<{title:string;rows:Breakdown[]}|null>(null);
 const cache=useRef(new Map<string,{at:number;data:Snapshot}>()).current;
 const seq=useRef(0),busy=useRef(false);const key=`${from}/${to}/${source}`;
 const load=useCallback(async(force=false)=>{
  const id=++seq.current;setError('');
  const saved=cache.get(key);if(!force&&saved&&Date.now()-saved.at<30000){setData(saved.data);setLoading(false);return;}
  if(!force)setData(null);setLoading(true);busy.current=true;
  try{
   const r=await supabase.functions.invoke('admin-command-center',{body:{action:'snapshot',from,to,source}});
   if(r.error){let message=r.error.message;try{message=(await r.error.context.json()).error||message;}catch{/* network */}throw new Error(message);}
   if(!r.data?.ok)throw new Error(r.data?.error||'Dashboard tidak tersedia');
   if(seq.current!==id)return;cache.set(key,{at:Date.now(),data:r.data});if(cache.size>20)cache.delete(cache.keys().next().value!);setData(r.data);
  }catch(e){if(seq.current===id)setError((e as Error).message);}finally{if(seq.current===id){setLoading(false);busy.current=false;}}
 },[from,to,source,key]);
 useEffect(()=>{void load();return()=>{seq.current++;};},[load]);
 useEffect(()=>{if(!auto)return;const t=window.setInterval(()=>{if(document.visibilityState==='visible'&&!busy.current)void load(true);},60000);return()=>window.clearInterval(t);},[auto,load]);
 const selectPreset=(p:string)=>{setPreset(p);if(p==='custom')return;const d=day();setTo(p==='yesterday'?before(d,1):d);setFrom(p==='yesterday'?before(d,1):before(d,p==='7'?6:p==='30'?29:0));};
 const showBreakdown=(title:string,rows:Breakdown[])=>setDetail({title,rows});
 const ordersLink=(view='all',period=false)=>adminHref('orders',{orders_view:view,...period?{filters:JSON.stringify({view,createdFrom:from,createdTo:to})}:{}});
 const mpLink=(status='all',shipBy='all')=>adminHref('marketplace-orders',{mp_status:status,mp_ship_by:shipBy});
 const p=data?.order.period||{},b=data?.order.backlog||{},i=data?.inbox,caps=data?.capabilities;
 const trend=data?.order.trend||[];
 const chatLink=(name='',channel='')=>adminHref('ai-dashboard',{ai_q:name,ai_channel:channel});
 const focusRows=data?.order.focus.filter(f=>focusType==='all'||f.module===focusType)||[];
 const focusLink=(f:Snapshot['order']['focus'][number])=>f.module==='orders'?adminHref('orders',{order:f.reference}):f.module==='marketplace-orders'?adminHref('marketplace-orders',{marketplace_q:f.reference}):adminHref(f.module);
 const periodHint=`${from} → ${to} · MYT`;
 return <div className="cc fade-in">
  <div className="cc-heading"><div><h1>Business Command Center</h1><p>Seluruh operasi iCetak dalam satu pandangan</p></div><div className="cc-heading-actions"><button className="btn" onClick={()=>void load(true)} disabled={loading}>{loading?'Memuatkan…':'↻ Muat semula'}</button>{onQuickOrder&&<button className="btn btn-primary" onClick={onQuickOrder}><IconPlus size={14}/> Create Order</button>}</div></div>
  <div className="cc-toolbar"><div className="cc-presets">{[['today','Today'],['yesterday','Semalam'],['7','7 hari'],['30','30 hari'],['custom','Custom']].map(([v,label])=><button key={v} className={preset===v?'active':''} onClick={()=>selectPreset(v)}>{label}</button>)}</div><label className="cc-source">Sumber<select aria-label="Sumber data" value={source} onChange={e=>setSource(e.target.value)}><option value="all">Semua sumber</option><option value="icetak">iCetak / WhatsApp</option><option value="shopee">Shopee</option></select></label><label className="cc-auto"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/> Auto refresh 60s</label></div>
  {preset==='custom'&&<div className="cc-date-range"><label>Dari<input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></label><label>Hingga<input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)}/></label><small>Maksimum 93 hari</small></div>}
  <nav className="cc-tabs" aria-label="Dashboard views">{tabs.map(([key,label])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)} aria-current={tab===key?'page':undefined}>{label}</button>)}</nav>
  {error&&<div className="cc-error" role="alert">{error} <button onClick={()=>void load(true)}>Cuba semula</button>{data&&<span> Data di bawah ialah snapshot terakhir, bukan hasil refresh ini.</span>}</div>}
  {data?.warnings.map(w=><div className="cc-warning" key={w}>{w}</div>)}
  {!data?<div className="cc-loading" aria-live="polite">{loading?<><span className="spinner"/> Mengumpulkan metrik Order System dan Unified Inbox…</>:<span>Tiada snapshot tersedia. Muat semula untuk cuba lagi.</span>}</div>:<>
   <div className="cc-context"><span>{periodHint}</span><span>Snapshot: {dateTime(data.fetched_at)} {loading?'· Memuat semula…':''}</span></div>
   <div className="cc-metrics">
    <Metric label="Order masuk" value={number(p.orders)} hint={`${number(p.icetak_orders)} iCetak · ${number(p.shopee_orders)} Shopee`} href={source==='shopee'?mpLink():ordersLink('all',true)}/>
    {caps?.finance&&<><Metric label="Jualan / GMV" value={money(p.gmv)} hint={`MYR · ${number(p.cancelled)} order batal dikecualikan`} href={adminHref('finance')}/><Metric label="Bayaran diterima" value={money(p.payments_received)} hint="Transaksi iCetak · bukan Shopee payout" href={adminHref('qrpay-summary',{date:to})}/></>}
    {caps?.chat&&<><Metric label="Lead baru" value={number(p.new_leads)} hint="Lead rasmi direkodkan"/><Metric label="Chat masuk" value={number(i?.period.inbound)} hint={i?`${number(i.period.new_conversations)} conversation baru`:'Inbox belum tersedia'} href={chatLink()}/><Metric label="Quotation dihantar" value={number(p.quotes)} hint="Event penghantaran yang disahkan admin"/></>}
   </div>
   <section className="cc-attention"><div className="cc-attention-title"><b>Perlu perhatian</b><small>Backlog semasa · klik untuk tindakan</small></div><div className="cc-attention-items">
    {caps?.chat&&<a href={chatLink()}><strong>{number(i?.attention.urgent)}</strong><span>Chat ditanda priority tinggi</span><small>Triage perlu semakan</small></a>}
    {caps?.finance&&<a href={adminHref('qrpay-summary')}><strong>{number(b.payment_attention)}</strong><span>Payment perlu semakan</span><small>Alert belum resolved</small></a>}
    <a href={ordersLink('design')}><strong>{number(b.design_review)}</strong><span>Order semakan design</span><small>Customer approval</small></a>
    <a href={mpLink('TO_SHIP')}><strong>{number(b.ship_overdue+b.ship_by_today)}</strong><span>Shopee deadline ≤ hari ini</span><small>{number(b.ship_overdue)} lewat · {number(b.ship_by_today)} hari ini</small></a>
    <a href={ordersLink('overdue')}><strong>{number(b.overdue)}</strong><span>Order iCetak overdue</span><small>Tarikh perlu belum selesai</small></a>
   </div></section>
   <div className="cc-grid">
   {(tab==='overview'||tab==='orders')&&<>
    <Panel title="Order harian" hint={`Tempoh dipilih · ${number(p.previous_orders)} order dalam tempoh sebelumnya`}><OrdersChart rows={trend} onDay={d=>{setPreset('custom');setFrom(d);setTo(d);}}/></Panel>
    <Panel title="Fokus hari ini" hint="Order / draft yang memerlukan tindakan" action={<div style={{display:'flex',gap:8,alignItems:'center'}}>{onOpenFocus?<button onClick={onOpenFocus}>Buka Fokus Customer</button>:null}<select aria-label="Jenis focus" value={focusType} onChange={e=>setFocusType(e.target.value)}><option value="all">Semua</option><option value="orders">iCetak</option><option value="marketplace-orders">Shopee</option><option value="draft-orders">Draft</option></select></div>}>
     <div className="cc-focus-scroll"><table className="cc-table cc-focus-table"><thead><tr><th>Perkara</th><th>Sebab</th><th>Tindakan</th></tr></thead><tbody>{focusRows.slice(0,12).map(f=><tr key={f.key}><td><div className="cc-focus-customer"><DeliveryIcon method={f.delivery_method}/><b>{f.name||f.reference}</b><WhatsAppShortcuts phone={f.phone} name={f.name||f.reference}/></div><small><span>{f.reference}</span><Copy value={f.reference}/></small></td><td>{f.reason}<small>{f.deadline?dateTime(f.deadline):'—'}</small></td><td>{f.module==='orders'&&onOpenOrder?<button onClick={()=>onOpenOrder(f.reference)}>Buka order</button>:<a href={focusLink(f)}>Semak ↗</a>}</td></tr>)}</tbody></table>{!focusRows.length&&<p className="cc-empty">Tiada item dalam focus ini.</p>}</div>
    </Panel>
    <BreakdownPanel title="Pipeline operasi" hint="Backlog semasa · order dan komponen berbeza unit" rows={data.order.pipeline} onSelect={r=>{if(r.module)window.location.assign(r.module==='orders'?ordersLink(r.filter||'active'):r.module==='marketplace-orders'?mpLink(r.filter):adminHref(r.module));}}/>
    <BreakdownPanel title="Courier mix" hint="Order shipment dicipta dalam tempoh dipilih · unique order per courier" rows={data.order.couriers} color="orange" onSelect={()=>showBreakdown('Courier mix',data.order.couriers)}/>
   </>}
   {tab==='orders'&&<><BreakdownPanel title="Production workload" hint="Komponen order aktif sahaja; status ClickUp/customer stage" rows={data.order.production}/><BreakdownPanel title="Produk / item paling banyak" hint="Unit item bagi order tempoh dipilih, cancellation dikecualikan" rows={data.order.products}/><Panel title="Draft & pickup"><div className="cc-mini-metrics"><Metric label="Draft aktif" value={number(b.drafts)} hint="Menunggu admin / customer / payment" href={adminHref('draft-orders')}/><Metric label="Ready pickup" value={number(b.ready_pickup)} hint="Belum collected" href={adminHref('pickup-counter')}/><Metric label="Order due today" value={number(b.due_today)} hint="iCetak · tarikh perlu" href={ordersLink('today')}/></div></Panel></>}
   {(tab==='overview'||tab==='sales')&&caps?.chat&&<>
    <Panel title="Chat penting" hint="30 hari terkini · semakan admin, bukan provider needs_reply" action={<a href={chatLink()}>Buka AI Dashboard ↗</a>}>
     {i?<div className="cc-chat-focus">{i.focus.slice(0,5).map(c=><a key={c.id} href={chatLink(c.name,c.channel)}><div><b>{c.name}</b><span className={`cc-badge ${c.channel==='shopee'?'orange':'good'}`}>{c.channel}</span></div><p>{c.snippet}</p><small>{dateTime(c.last_inbound_at)} · Triage P{c.priority??'—'}</small></a>)}</div>:<p className="cc-empty">Inbox belum tersedia. Tiada angka chat dianggap sifar.</p>}
    </Panel>
    <Panel title="Sales funnel" hint="Rekod rasmi · closed won mesti dipautkan kepada order sebenar"><Bars rows={Object.entries(stages).map(([stage,label])=>({label,value:data.order.sales_funnel.find(r=>r.label===stage)?.value||0}))}/><div className="cc-funnel-outcomes"><span><b>{number(p.won)}</b> Won dalam tempoh</span><span><b>{number(p.lost)}</b> Lost dalam tempoh</span></div></Panel>
   </>}
   {tab==='sales'&&caps?.chat&&<>
    <BreakdownPanel title="Chat mengikut channel" hint="Mesej inbound dalam tempoh; history import dikecualikan" rows={i?.channels||[]}/>
    <BreakdownPanel title="Kategori kehendak customer" hint="Triage sedia ada untuk customer aktif dalam tempoh" rows={i?.intents||[]}/>
    <BreakdownPanel title="Chat menunggu semakan" hint="Aging inbound terkini · resolusi rasmi admin" rows={i?.aging||[]} color="orange"/>
    <Panel title="Conversation control"><div className="cc-mini-metrics"><Metric label="Perlu semakan ≤30 hari" value={number(i?.attention.needs_review)} hint="Bukan semestinya belum dibalas" href={chatLink()}/><Metric label="Tunggu customer" value={number(i?.attention.waiting_customer)} hint="Admin telah mark replied"/><Metric label="Backlog lama" value={number(i?.attention.legacy_backlog)} hint="Lebih 30 hari · berasingan"/></div></Panel>
    <SalesPanel rows={data.order.opportunities} canManage={caps.manage_sales} onSaved={()=>void load(true)}/>
   </>}
   {tab==='shipping'&&<>
    <Panel title="Shipping control" full hint="Backlog semasa · Shopee platform status dan courier status berasingan"><div className="cc-mini-metrics"><Metric label="Shopee To Ship" value={number(b.to_ship)} hint="READY_TO_SHIP + PROCESSED" href={mpLink('TO_SHIP')}/><Metric label="Shipping / receipt" value={number(b.shipping)} hint="iCetak + Shopee sedang dihantar" href={mpLink('SHIPPED')}/><Metric label="Shipment attention" value={number(b.shipment_attention)} hint="Alert iCetak belum resolved" href={adminHref('shipping')}/><Metric label="Deadline belum sah" value={number(b.ship_deadline_unknown)} hint="Shopee ship-by kosong / 1970" href={mpLink('TO_SHIP')}/></div></Panel>
    <BreakdownPanel title="Courier mix" hint="Order shipment dicipta dalam tempoh dipilih" rows={data.order.couriers} color="orange"/>
    <BreakdownPanel title="Status shipment / platform" hint="Semua rekod semasa · COMPLETED Shopee bukan bukti delivered courier" rows={data.order.shipping_status}/>
    <BreakdownPanel title="Delivery aging iCetak" hint="Shipped tetapi belum delivered; hanya shipped_at yang disahkan" rows={data.order.shipping_aging} color="orange"/>
    <BreakdownPanel title="Return / refund records" hint="Status terakhir diterima · bukan semuanya masih terbuka" rows={data.order.returns} color="orange"/>
   </>}
   {tab==='finance'&&<>
    {caps?.finance?<><Panel title="Finance snapshot" full hint="GMV, cash diterima dan settlement mesti dibaca berasingan"><div className="cc-mini-metrics"><Metric label="GMV MYR" value={money(p.gmv)} hint={`${number(p.gmv_missing)} order tiada nilai financial`}/><Metric label="Bayaran diterima" value={money(p.payments_received)} hint="Transaksi iCetak dalam tempoh" href={adminHref('qrpay-summary')}/><Metric label="Unpaid backlog" value={money(b.unpaid_value)} hint={`${number(b.unpaid)} order aktif belum bayar`} href={ordersLink('to_pay')}/><Metric label="Shopee released" value={money(data.order.settlement?.released)} hint="Payout released dalam tempoh"/></div></Panel><BreakdownPanel title="Kaedah bayaran iCetak" hint="Order dalam tempoh dipilih" rows={data.order.payment_methods||[]}/><Panel title="Settlement & profitability"><dl className="cc-definition"><div><dt>Shopee fees dalam tempoh</dt><dd>{money(data.order.settlement?.fees)}</dd></div><div><dt>Income ledger</dt><dd>{money(data.order.ledger?.income)}</dd></div><div><dt>Expenses ledger</dt><dd>{money(data.order.ledger?.expense)}</dd></div><div><dt>Profit / loss ledger</dt><dd>{money(data.order.ledger?.profit)}</dd></div><div><dt>Foreign currency orders</dt><dd>{number(p.foreign_currency_orders)} · diasingkan daripada GMV MYR</dd></div></dl><p className="cc-note">Ledger sedia ada: entry posted sahaja, seluruh sumber bagi tempoh dipilih. Ini bukan margin setiap order atau pengesahan semua kos bahan sudah direkod.</p></Panel></>:<Panel title="Finance permissions"><p>Akses finance diperlukan untuk nilai wang dan financial reports.</p></Panel>}
    <Panel title="System health" full hint="Freshness menunjukkan event terakhir, bukan jaminan semua integrasi sihat"><div className="cc-health-grid">{[['Shopee webhook',data.order.health.last_shopee_webhook],['ClickUp webhook',data.order.health.last_clickup_webhook],['WhatsApp webhook',i?.health.last_whatsapp_webhook],['Order update',data.order.health.last_order_update]].map(([label,v])=><div key={String(label)}><span>{label}</span><b>{dateTime(v)}</b></div>)}</div><div className="cc-health-links"><a href={adminHref('whatsapp-control')}>Notification failed <b>{number(data.order.health.notification_failed)}</b></a><a href={adminHref('clickup-queue')}>ClickUp retry/error <b>{number(data.order.health.clickup_failed)}</b></a><a href={adminHref('integrations')}>Outbox retry/error <b>{number(data.order.health.outbox_failed)}</b></a><a href={chatLink()}>AI job failed <b>{number(i?.health.ai_failed)}</b></a></div></Panel>
    {caps?.chat&&<><BreakdownPanel title="AI feedback" hint="Penilaian admin dalam tempoh · belum dianggap accuracy model" rows={data.order.ai_training}/><BreakdownPanel title="Aktiviti admin chat" hint="Bilangan tindakan review; bukan masa bekerja atau ranking prestasi" rows={data.order.staff_activity.map(r=>({label:r.actor,value:r.actions}))}/></>}
   </>}
   </div>
   <details className="cc-data-notes"><summary>Definisi angka & liputan data</summary><ul>{[...data.order.limitations.filter(t=>!t.startsWith('Expenses,')),...i?.limitations||[]].map(t=><li key={t}>{t}</li>)}</ul></details>
  </>}
  {detail&&<div className="cc-modal-backdrop"><div className="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-detail-title"><div className="cc-panel-head"><h2 id="cc-detail-title">{detail.title}</h2><button onClick={()=>setDetail(null)} aria-label="Tutup">×</button></div><Bars rows={detail.rows}/><a href={adminHref('shipping')}>Buka Shipping ↗</a></div></div>}
 </div>;
}
