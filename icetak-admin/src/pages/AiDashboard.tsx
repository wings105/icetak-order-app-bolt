import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import './AiDashboard.css';

type Data = Record<string, any>;
type Row = Data & { id: string; name: string; channel: string; context: Data; analysis: Data };
const intents:Record<string,string>={complaint:'Aduan',shipping:'Parcel / shipping',design:'Design / saiz',payment:'Bayaran / link',new_order:'Order baharu',enquiry:'Pertanyaan',followup:'Follow-up',other:'Perlu dibaca'};
const states:Record<string,string>={needs_review:'Perlu tindakan',waiting_customer:'Menunggu pelanggan',snoozed:'Ditangguhkan',resolved:'Selesai'};
const date=(v?:string)=>v?new Date(v).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const money=(v:unknown)=>v===null||v===undefined?'Belum tersedia':`RM ${Number(v).toFixed(2)}`;
const safeUrl=(v:unknown)=>{try{const u=new URL(String(v));return u.protocol==='https:'?u.href:undefined;}catch{return undefined;}};
async function call(body:Data){
 const {data,error}=await supabase.functions.invoke('admin-ai-dashboard',{body});
 if(error){let message=error.message;try{const payload=await error.context?.json();message=payload?.error||message;}catch{/* network error */}throw new Error(message);}
 if(!data?.ok)throw new Error(data?.error||'Permintaan gagal. Cuba semula.');return data;
}
type Props={onOpenOrder:(orderNo:string)=>void;onOpenDrafts:()=>void;canViewDrafts:boolean};
export default function AiDashboard({onOpenOrder,onOpenDrafts,canViewDrafts}:Props){
 const [rows,setRows]=useState<Row[]>([]),[channel,setChannel]=useState(''),[search,setSearch]=useState(''),[query,setQuery]=useState('');
 const [status,setStatus]=useState('needs_review'),[intent,setIntent]=useState(''),[sort,setSort]=useState('priority');
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[more,setMore]=useState(false),[offset,setOffset]=useState(0);
 const [selected,setSelected]=useState<Row|null>(null),[detailLoading,setDetailLoading]=useState(false),[events,setEvents]=useState<Data[]>([]);
 const [caps,setCaps]=useState<Data>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [response,setResponse]=useState(''),[note,setNote]=useState(''),[override,setOverride]=useState('');
 const [confirm,setConfirm]=useState<'send'|'manual_replied'|'resolve'|null>(null),[fetched,setFetched]=useState('');
 const requestSeq=useRef(0),detailSeq=useRef(0),dialogRef=useRef<HTMLDivElement>(null),closeRef=useRef<HTMLButtonElement>(null);
 const [dirty,setDirty]=useState(false),[closeConfirm,setCloseConfirm]=useState(false);
 const sendKey=useRef<string|null>(null);
 const load=useCallback(async(append=false)=>{
  const seq=++requestSeq.current;setLoading(true);setError('');
  try{const page=append?offset:0;const d=await call({action:'list',channel,search:query,offset:page});
   if(seq!==requestSeq.current)return;
   setRows(old=>append?Array.from(new Map([...old,...d.rows].map((r:Row)=>[r.id,r])).values()) as Row[]:d.rows);
   setMore(d.has_more);setOffset(page+d.rows.length);setCaps(d.capabilities);setFetched(d.fetched_at);
  }catch(e){if(seq===requestSeq.current)setError((e as Error).message);}finally{if(seq===requestSeq.current)setLoading(false);}
 },[channel,query,offset]);
 useEffect(()=>{void load(false);return()=>{requestSeq.current++;};},[channel,query]); // Explicit refresh avoids replacing an admin's work while editing.
 const open=async(row:Row)=>{
  const seq=++detailSeq.current;setSelected(row);setDetailLoading(true);setError('');setNotice('');setConfirm(null);setDirty(false);sendKey.current=null;
  try{const d=await call({action:'detail',conversation_id:row.id});if(seq!==detailSeq.current)return;
   setSelected(d.row);setEvents(d.events||[]);setCaps(d.capabilities);setResponse(d.row.analysis.response_text||'');
   setNote(d.row.context.review?.note||'');setOverride(d.row.context.review?.intent_override||'');setFetched(d.fetched_at);
  }catch(e){if(seq===detailSeq.current)setError((e as Error).message);}finally{if(seq===detailSeq.current)setDetailLoading(false);}
 };
 const close=()=>{if(busy)return;if(dirty){setCloseConfirm(true);return;}detailSeq.current++;setSelected(null);setConfirm(null);};
 useEffect(()=>{
  if(!selected)return;const previous=document.activeElement as HTMLElement|null;closeRef.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();if(!busy){if(dirty)setCloseConfirm(true);else{detailSeq.current++;setSelected(null);}}}
   if(e.key==='Tab'){
    const nodes=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],textarea,select,input')||[]).filter(n=>n.offsetParent!==null);
    const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
   }
  };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[selected?.id,dirty,busy]);
 const act=async(action:string)=>{
  if(!selected||busy||detailLoading)return;setBusy(true);setError('');setNotice('');
  try{
   const sending=action==='send';if(sending&&!sendKey.current)sendKey.current=crypto.randomUUID();
   const result=await call({action:sending?'send':'review',conversation_id:selected.id,
    inbound_revision:selected.inbound_revision,revision:selected.revision,
    expected_version:selected.context.review?.version||0,request_id:sending?sendKey.current:crypto.randomUUID(),
    review_action:action,response_text:response,note,intent_override:override||null,approved:sending});
   setConfirm(null);setDirty(false);
   const message=sending?`Provider mengesahkan penghantaran. ${result.warning||'Tandakan selesai hanya jika isu sudah dijawab.'}`:
    action==='manual_replied'?'Direkod sebagai balasan manual atas pengesahan admin.':'Tindakan disimpan.';
   await open(selected);setNotice(message);void load(false);
  }catch(e){setError((e as Error).message);setConfirm(null);}finally{setBusy(false);}
 };
 const copy=async()=>{try{await navigator.clipboard.writeText(response);setNotice('Balasan disalin. Tampal dalam chat pelanggan yang betul.');}catch{setNotice('Tidak dapat salin automatik. Pilih teks balasan dan salin secara manual.');}};
 const visible=rows.filter(r=>(!status||r.analysis.status===status)&&(!intent||r.analysis.intent===intent)).sort((a,b)=>sort==='oldest'?Date.parse(a.last_inbound_at||'')-Date.parse(b.last_inbound_at||''):sort==='latest'?Date.parse(b.last_inbound_at||'')-Date.parse(a.last_inbound_at||''):b.analysis.priority-a.analysis.priority);
 const count=(state:string)=>rows.filter(r=>r.analysis.status===state).length;
 const ctx=selected?.context||{},a=selected?.analysis||{};
 const waPhone=String(ctx.phone||'').replace(/\D/g,'');
 const waLink=waPhone?`https://web.whatsapp.com/send?phone=${encodeURIComponent(waPhone)}&text=${encodeURIComponent(response)}`:null;
 const windowExpires=selected?(Date.parse(selected.window_expires_at||'')||Date.parse(selected.last_inbound_at||'')+86400000):0;
 const canSend=!!(selected?.channel==='whatsapp'&&caps.whatsapp_api&&caps.can_manage&&windowExpires>Date.now()&&ctx.identity_status!=='ambiguous');
 return <section className="ai-board">
  <div className="ai-heading"><div><span className="ai-eyebrow">WHATSAPP + SHOPEE</span><h1>AI Action Dashboard</h1><p>Fahami permintaan, semak bukti, kemudian pilih tindakan.</p></div><div className="ai-heading-actions"><span className="ai-mode">Semakan admin • Auto-send OFF</span><button disabled={loading} onClick={()=>void load(false)}>↻ Muat semula</button></div></div>
  <div className="ai-stats">{Object.entries(states).map(([key,label])=><button key={key} className={status===key?'selected':''} onClick={()=>setStatus(key)}><span>{label}</span><strong>{count(key)}</strong><small>daripada {rows.length} kad dimuat</small></button>)}</div>
  <form className="ai-filters" onSubmit={e=>{e.preventDefault();setQuery(search.trim());}}>
   <input aria-label="Cari pelanggan" placeholder="Nama, Shopee username atau telefon…" value={search} onChange={e=>setSearch(e.target.value)}/><button type="submit">Cari</button>
   <select aria-label="Channel" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">Semua channel</option><option value="whatsapp">WhatsApp</option><option value="shopee">Shopee</option></select>
   <select aria-label="Jenis permintaan" value={intent} onChange={e=>setIntent(e.target.value)}><option value="">Semua permintaan</option>{Object.entries(intents).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   <select aria-label="Status tindakan" value={status} onChange={e=>setStatus(e.target.value)}><option value="">Semua status</option>{Object.entries(states).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
   <select aria-label="Susunan" value={sort} onChange={e=>setSort(e.target.value)}><option value="priority">Keutamaan</option><option value="oldest">Paling lama menunggu</option><option value="latest">Chat terkini</option></select>
  </form>
  <div className="ai-list-meta"><span>{visible.length} kad dipaparkan · Susunan dan jumlah berdasarkan kad dimuat</span><span>Disemak {date(fetched)} MYT</span></div>
  {error&&!selected&&<div role="alert" className="ai-error">{error} <button onClick={()=>void load(false)}>Cuba semula</button></div>}
  {loading&&!rows.length?<div className="ai-empty" role="status">Memuatkan chat dan konteks order…</div>:<div className="ai-grid">{visible.map(row=><button className={`ai-card ${row.analysis.urgent?'urgent':''}`} key={row.id} onClick={()=>void open(row)}>
   <div className="ai-card-top"><span className={`ai-channel ${row.channel}`}>{row.channel==='shopee'?'Shopee':'WhatsApp'}</span><span>{date(row.last_inbound_at)}</span></div>
   <h2>{row.context.customer?.name||row.name||'Pelanggan'}</h2><span className="ai-intent">{row.analysis.intent_label}</span>
   <p>{row.analysis.summary}</p><div className="ai-card-facts"><span>{row.context.orders.length+row.context.marketplace_orders.length} order berkaitan</span><span>{row.context.identity_status==='matched'?'CRM dipadankan':row.context.identity_status==='ambiguous'?'Semak identiti':'Belum dipadankan'}</span></div>
   <div className="ai-card-bottom"><span>{row.analysis.reopened?'Mesej baharu · dibuka semula':states[row.analysis.status]}</span><strong>Semak →</strong></div>
  </button>)}</div>}
  {!loading&&!visible.length&&<div className="ai-empty"><h2>Tiada kad dalam tapisan ini</h2><p>Tukar tapisan atau muatkan chat seterusnya. Ini bukan pengesahan semua chat sudah selesai.</p><button onClick={()=>{setStatus('');setIntent('');}}>Lihat semua kad dimuat</button></div>}
  {more&&<div className="ai-more"><button disabled={loading} onClick={()=>void load(true)}>{loading?'Memuatkan…':'Muat 30 chat seterusnya'}</button></div>}
  {selected&&<div className="ai-overlay"><div className="ai-detail" role="dialog" aria-modal="true" aria-labelledby="ai-detail-name" ref={dialogRef}>
   <header><div><span className={`ai-channel ${selected.channel}`}>{selected.channel}</span><h2 id="ai-detail-name">{ctx.customer?.name||selected.name}</h2><small>{ctx.phone||'Telefon belum dipadankan'} · {states[a.status]}</small></div><button ref={closeRef} aria-label="Tutup butiran" onClick={close} disabled={busy}>✕</button></header>
   {detailLoading?<div className="ai-empty" role="status">Memuatkan bukti dan semakan konteks…</div>:<>
    {error&&<div className="ai-error" role="alert">{error}<button disabled={busy} onClick={()=>{if(dirty)setCloseConfirm(true);else void open(selected);}}>Muat semula butiran</button></div>}
    {notice&&<div className="ai-notice" role="status">{notice}</div>}
    <div className="ai-detail-grid"><div className="ai-context">
     <section className="ai-box"><div className="ai-section-title"><h3>{a.intent_label}</h3><span className="ai-confidence">Bukti {a.confidence}</span></div><p>{a.summary}</p><small>{a.basis} · {a.engine}</small><p className="ai-muted">{a.confidence_note}</p>
      {a.warnings?.map((w:string)=><p key={w} className="ai-warning">{w}</p>)}
     </section>
     <section className="ai-box"><h3>Order & bayaran</h3><p className="ai-muted">Status di bawah datang daripada Order System. Pilih dan semak order yang dimaksudkan pelanggan.</p>
      {!ctx.orders?.length&&!ctx.marketplace_orders?.length&&<p>Belum ada order dipadankan.</p>}
      {ctx.orders?.map((o:Data)=><div key={o.id} className="ai-order"><div><strong>{o.order_no}</strong><b>{money(o.total)}</b></div><p>{o.status} · Bayaran: <strong>{o.payment_status||'Belum diketahui'}</strong></p><p>{o.fulfillment_stage||'—'} · {o.shipment_status||'Tiada status shipment'} · {o.tracking||'Tiada tracking'}</p><small>Bayaran disahkan: {date(o.payment_verified_at)} · Kemaskini: {date(o.updated_at)}</small>{o.items?.map((i:Data,n:number)=><p key={n}>{i.quantity}× {i.title} {i.size} {i.wording&&`· ${i.wording}`}</p>)}<button onClick={()=>onOpenOrder(o.order_no)}>Buka order</button></div>)}
      {ctx.marketplace_orders?.map((o:Data)=><div key={o.id} className="ai-order"><div><strong>{o.order_sn}</strong><span className="ai-channel shopee">Shopee</span></div><p>Order: <strong>{o.current_status||'Belum diketahui'}</strong> · Bayaran platform: {o.payment_status||'Belum diketahui'}</p><p>{o.financials?.length?o.financials.map((f:Data)=>`${money(f.buyer_paid)} · ${f.payment_method||'Kaedah tidak diketahui'}`).join(' / '):'Butiran kewangan belum tersedia'}</p><small>Order: {date(o.placed_at)} · Kemaskini provider: {date(o.latest_provider_update_at)}</small>{o.items?.map((i:Data,n:number)=><p key={n}>{i.quantity}× {i.title} · {i.variation||''} {i.sku&&`[${i.sku}]`}</p>)}{!o.detail_complete&&<p className="ai-warning">Butiran order belum lengkap.</p>}{o.shipments?.map((s:Data,n:number)=><p key={n}>{s.courier_name||'Courier'} · {s.tracking_number||'Tiada tracking'} · {s.shipment_status||s.fulfillment_status||'Status belum tersedia'}</p>)}</div>)}
     </section>
     <section className="ai-box"><h3>Session & draft</h3><p>Session: {ctx.session?.session_status||'Tiada session aktif'}</p><p>Sempadan chat lama: {date(a.session_boundary)}</p><p>{a.draft_message_count} mesej tersedia selepas sempadan session.</p>{ctx.drafts?.map((d:Data)=><p key={d.id}>{d.status} · {money(d.draft_total)} · {d.payment_status||'—'}</p>)}{canViewDrafts&&<button onClick={onOpenDrafts}>Buka Draft Orders</button>}<small className="ai-block">Gunakan aliran draft sedia ada. Dashboard ini tidak mencipta real order secara automatik.</small></section>
     {!!ctx.addresses?.length&&<details className="ai-box"><summary>Alamat CRM ({ctx.addresses.length})</summary>{ctx.addresses.map((ad:Data,n:number)=><p key={n}>{[ad.recipient_name,ad.address_line1,ad.address_line2,ad.postcode,ad.city,ad.state].filter(Boolean).join(', ')}<small className="ai-block">Sumber: {ad.source_provider||'CRM'} · {ad.is_verified?'Disahkan':'Belum disahkan'}</small></p>)}</details>}
     <details className="ai-box" open><summary>Bukti chat ({selected.messages?.length||0} mesej)</summary><div className="ai-evidence">{selected.messages?.map((m:Data)=><article className={m.direction==='inbound'?'inbound':'outbound'} key={m.id}><small>{m.direction==='inbound'?'Pelanggan':'Seller / automation'} · {date(m.created_at)} · {m.source||m.message_type}</small><p>{m.text_content||m.caption||`[${m.message_type}]`}</p>{safeUrl(m.media_url)&&(m.message_type==='image'?<a href={safeUrl(m.media_url)} target="_blank" rel="noopener noreferrer"><img loading="lazy" src={safeUrl(m.media_url)} alt="Lampiran pelanggan"/></a>:<a href={safeUrl(m.media_url)} target="_blank" rel="noopener noreferrer">Buka lampiran</a>)}</article>)}</div></details>
    </div><aside className="ai-compose"><section className="ai-box"><h3>Cadangan balasan</h3><p className="ai-muted">Draf SOP untuk disemak. Harga, ukuran dan janji siap mesti disahkan admin.</p><label htmlFor="ai-response">Edit sebelum membalas</label><textarea id="ai-response" value={response} onChange={e=>{setResponse(e.target.value);setDirty(true);sendKey.current=null;}} rows={8} maxLength={4000} disabled={busy||!caps.can_manage}/>
     <div className="ai-button-row"><button onClick={()=>void copy()} disabled={!response}>Salin balasan</button>{selected.channel==='whatsapp'?(waLink?<a className="ai-button" href={waLink} target="_blank" rel="noopener noreferrer">Buka WhatsApp Web ↗</a>:<span className="ai-muted">Telefon diperlukan untuk buka WhatsApp Web.</span>):<a className="ai-button" href="https://seller.shopee.com.my/webchat/conversations" target="_blank" rel="noopener noreferrer">Buka Shopee Chat ↗</a>}</div>
     {selected.channel==='shopee'&&<p className="ai-muted">Cari username <strong>{selected.name}</strong>, kemudian tampal balasan.</p>}
     <p className="ai-muted">Buka chat / salin tidak menandakan mesej sudah dihantar.</p>
     <button className="ai-primary ai-wide" disabled={busy||!caps.can_manage||!response.trim()} onClick={()=>setConfirm('manual_replied')}>Saya sudah balas manual</button>
     <button className="ai-wide" disabled={busy||!canSend||!response.trim()} onClick={()=>setConfirm('send')}>Semak & hantar melalui API</button>
     {!canSend&&<small className="ai-block">{selected.channel==='shopee'?'Adapter Shopee API belum tersedia; gunakan Seller Chat.':caps.send_reason||'API memerlukan window aktif, identiti jelas dan akses pengurusan CRM.'}</small>}
    </section><section className="ai-box"><h3>Keputusan admin</h3><label htmlFor="ai-intent">Betulkan kategori</label><select id="ai-intent" value={override} onChange={e=>{setOverride(e.target.value);setDirty(true);}} disabled={busy||!caps.can_manage}><option value="">Ikut cadangan sistem</option>{Object.entries(intents).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><label htmlFor="ai-note">Nota / sebab pembetulan</label><textarea id="ai-note" value={note} rows={3} maxLength={2000} onChange={e=>{setNote(e.target.value);setDirty(true);}} disabled={busy||!caps.can_manage}/><button className="ai-wide" disabled={busy||!caps.can_manage} onClick={()=>void act('save')}>Simpan draf & nota</button><div className="ai-button-row"><button disabled={busy||!caps.can_manage} onClick={()=>void act('snooze')}>Tangguh 24 jam</button><button disabled={busy||!caps.can_manage} onClick={()=>setConfirm('resolve')}>Selesai</button><button disabled={busy||!caps.can_manage} onClick={()=>void act('reopen')}>Buka semula</button></div><small className="ai-block">Mesej pelanggan baharu akan membuka semula kad. Auto-reply tidak menutup tindakan.</small></section>
     <details className="ai-box"><summary>Rekod semakan ({events.length})</summary>{events.length?events.map(ev=><p key={ev.id}><strong>{ev.action}</strong> · {ev.actor}<small className="ai-block">{date(ev.created_at)}</small>{ev.after_state?.note}</p>):<p>Belum ada semakan admin.</p>}</details>
    </aside></div>
   </>}
   {confirm&&<div className="ai-confirm" role="alertdialog" aria-labelledby="ai-confirm-title"><h3 id="ai-confirm-title">{confirm==='send'?'Hantar balasan ini melalui API?':confirm==='resolve'?'Permintaan pelanggan sudah selesai?':'Sahkan anda sudah membalas di chat asal'}</h3><p>{confirm==='send'?`Penerima: ${selected.name} · ${ctx.phone||selected.external_customer_id}`:confirm==='resolve'?'Status order dan bayaran tidak berubah. Mesej baharu akan membuka semula kad.':'Ini rekod pengesahan admin; sistem tidak menghantar mesej bagi tindakan ini.'}</p>{confirm!=='resolve'&&<blockquote>{response}</blockquote>}<div className="ai-button-row"><button disabled={busy} onClick={()=>setConfirm(null)}>Kembali</button><button className="ai-primary" disabled={busy} onClick={()=>void act(confirm)}>{busy?'Memproses…':confirm==='send'?'Ya, hantar API':'Sahkan'}</button></div></div>}
   {closeConfirm&&<div className="ai-confirm" role="alertdialog" aria-labelledby="ai-unsaved-title"><h3 id="ai-unsaved-title">Ada perubahan belum disimpan</h3><p>Simpan draf & nota dahulu, atau tutup tanpa menyimpan.</p><div className="ai-button-row"><button onClick={()=>setCloseConfirm(false)}>Sambung edit</button><button onClick={()=>{detailSeq.current++;setSelected(null);setDirty(false);setCloseConfirm(false);}}>Tutup tanpa simpan</button></div></div>}
  </div></div>}
 </section>;
}
