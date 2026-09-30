import { useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { adminHref, dateTime, money, phoneDigits, stages } from './contracts';
import type { Opportunity } from './contracts';
type Props={rows:Opportunity[];canManage:boolean;onSaved:()=>void};
export default function SalesPanel({rows,canManage,onSaved}:Props){
 const [show,setShow]=useState(false),[selected,setSelected]=useState<Opportunity|null>(null),[action,setAction]=useState('create');
 const [name,setName]=useState(''),[phone,setPhone]=useState(''),[source,setSource]=useState('whatsapp'),[identity,setIdentity]=useState('');
 const [amount,setAmount]=useState('0'),[note,setNote]=useState(''),[stage,setStage]=useState('qualified'),[loss,setLoss]=useState('');
 const [order,setOrder]=useState(''),[kind,setKind]=useState('icetak'),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const retry=useRef<{payload:string;id:string}|null>(null);
 function open(row:Opportunity|null,a:string){setSelected(row);setAction(a);setName(row?.customer_name||'');setPhone(row?.phone||'');setSource(row?.source||'whatsapp');setIdentity(row?.identity_key||'');setAmount(String(row?.estimated_value||0));setNote(row?.note||'');setStage('qualified');setLoss('');setOrder('');setConfirmed(false);setError('');retry.current=null;setShow(true);}
 async function save(){
  if(busy)return;
  if(action==='quote'&&!confirmed){setError('Sahkan quotation memang telah dihantar.');return;}
  if(stage==='won'&&action==='stage'&&!confirmed){setError('Sahkan order ini memang milik lead yang dipilih.');return;}
  let orderId='';
  setBusy(true);setError('');
  try{
   // Resolve a real canonical reference through existing admin read contracts; no order write.
   if(action==='stage'&&stage==='won'){
    if(!order.trim())throw new Error('Nombor order diperlukan.');
    const result=kind==='icetak'?await supabase.rpc('icetak_admin_orders_enterprise',{p_query:order.trim(),p_filters:{view:'all'},p_page:1,p_page_size:10}):await supabase.rpc('icetak_admin_marketplace_orders',{p_search:order.trim(),p_status:'all',p_provider:'all',p_ship_by:'all',p_limit:10,p_offset:0});
    if(result.error)throw result.error;
    const matches=(result.data?.rows||[]).filter((r:{id?:string;orderSn?:string})=>(kind==='icetak'?r.id:r.orderSn)?.toUpperCase()===order.trim().toUpperCase());
    if(matches.length!==1)throw new Error('Order tidak ditemui atau padanan tidak unik.');orderId=kind==='icetak'?matches[0].dbId:matches[0].id;
   }
   const data=action==='create'?{action,customer_name:name.trim(),phone,source,identity_key:source==='whatsapp'?phoneDigits(phone):identity.trim(),amount:Number(amount),note}:{action,id:selected?.id,version:selected?.version,amount:Number(amount),confirmed_sent:confirmed,confirmed_order:confirmed,stage,loss_reason:loss,order_kind:kind,order_id:orderId,note};
   const payload=JSON.stringify(data);if(!retry.current||retry.current.payload!==payload)retry.current={payload,id:crypto.randomUUID()};
   const r=await supabase.functions.invoke('admin-command-center',{body:{action:'sales',request_id:retry.current.id,data}});
   if(r.error){let message=r.error.message;try{message=(await r.error.context.json()).error||message;}catch{/* network */}throw new Error(message);}
   if(!r.data?.ok)throw new Error(r.data?.error||'Gagal simpan');setShow(false);onSaved();
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="cc-panel cc-full"><div className="cc-panel-head"><div><h2>Sales workspace</h2><p>Lead sebenar → quotation → keputusan. Tidak menghantar mesej atau mengubah order.</p></div>{canManage&&<button className="btn btn-primary" onClick={()=>open(null,'create')}>+ Rekod lead</button>}</div>
 {!rows.length?<p className="cc-empty">Belum ada lead rasmi direkodkan. Chat baru dan customer CRM tidak dianggap quotation atau closed secara automatik.</p>:<div className="cc-table-scroll"><table className="cc-table"><thead><tr><th>Customer</th><th>Channel</th><th>Stage</th><th>Nilai</th><th>Owner / Update</th><th>Tindakan</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><b>{r.customer_name}</b><div className="cc-phone">{phoneDigits(r.phone)?<><a href={`whatsapp://send?phone=${phoneDigits(r.phone)}`} title="WhatsApp app">{r.phone}</a><a href={`https://wa.me/${phoneDigits(r.phone)}`} target="_blank" rel="noreferrer" title="WhatsApp web">↗ wa.me</a></>:r.identity_key}</div></td><td>{r.source}</td><td><span className={`cc-badge ${r.stage==='won'?'good':r.stage==='lost'?'danger':''}`}>{stages[r.stage]}</span></td><td>{money(r.estimated_value)}</td><td>{r.owner}<small>{dateTime(r.updated_at)}</small></td><td>{canManage&&!['won','lost'].includes(r.stage)?<div className="cc-row-actions"><button onClick={()=>open(r,'quote')}>Quotation dihantar</button><button onClick={()=>open(r,'stage')}>Update stage</button></div>:<a href={adminHref('customers')}>CRM ↗</a>}</td></tr>)}</tbody></table></div>}
 {show&&<div className="cc-modal-backdrop" onKeyDown={e=>{if(e.key==='Escape'&&!busy)setShow(false);}}><form className="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-sales-title" onSubmit={e=>{e.preventDefault();void save();}}><div className="cc-panel-head"><h2 id="cc-sales-title">{action==='create'?'Rekod lead baharu':action==='quote'?'Rekod quotation telah dihantar':'Update lead'}</h2><button type="button" aria-label="Tutup" disabled={busy} onClick={()=>setShow(false)}>×</button></div>
  {action==='create'?<><label>Nama customer<input autoFocus required maxLength={160} value={name} onChange={e=>setName(e.target.value)}/></label><label>Channel<select value={source} onChange={e=>setSource(e.target.value)}><option value="whatsapp">WhatsApp</option><option value="shopee">Shopee</option><option value="walkin">Walk-in</option><option value="other">Lain-lain</option></select></label><label>Phone<input required={source==='whatsapp'} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="60123456789"/></label>{source!=='whatsapp'&&<label>Username / identifier<input required={source==='shopee'} value={identity} onChange={e=>setIdentity(e.target.value)} placeholder="Shopee username atau identifier unik"/></label>}</>:<p>{selected?.customer_name} · {selected?.source}</p>}
  {action!=='stage'&&<label>{action==='quote'?'Jumlah quotation':'Anggaran nilai'} (RM)<input type="number" required min="0" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
  {action==='quote'&&<label className="cc-checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Saya sudah menghantar quotation kepada customer. Ini hanya merekod tindakan.</label>}
  {action==='stage'&&<><label>Stage<select value={stage} onChange={e=>{setStage(e.target.value);setConfirmed(false);}}>{['qualified','waiting_customer','waiting_payment','won','lost'].map(s=><option key={s} value={s}>{stages[s]}</option>)}</select></label>{stage==='lost'&&<label>Sebab lost<textarea required minLength={3} maxLength={500} value={loss} onChange={e=>setLoss(e.target.value)}/></label>}{stage==='won'&&<><label>Order source<select value={kind} onChange={e=>setKind(e.target.value)}><option value="icetak">iCetak</option><option value="shopee">Shopee</option></select></label><label>Nombor order<input required value={order} onChange={e=>setOrder(e.target.value)} /></label><label className="cc-checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Saya sahkan order ini milik lead ini. Bayaran dan fulfillment tidak diubah.</label></>}</>}
  <label>Nota<textarea maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>{error&&<p role="alert" className="cc-error">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy?'Menyimpan…':'Simpan rekod'}</button>
 </form></div>}
 </section>;
}
