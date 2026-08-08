import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ADMIN_PRODUCTS, normalizeMalaysiaPhone, type AdminProductKind, type ProductReview } from '../lib/orderProducts';

type Item = { id:string; kind:AdminProductKind; title:string; qty:number; price:number; size:string; style:string; review:ProductReview; customText:string };
type Result = { order_id:string; order_db_id?:string; order_token:string; confirm_token?:string; total:number; notify_whatsapp?:boolean; notification_status?:string; links?:Record<string,string> };
type Props = { permissions?:string[]; onOpenOrder?:(orderNo:string)=>void };
type Summary = { global_enabled?:boolean; enabled_count?:number; total_count?:number };

const makeItem=():Item=>({id:crypto.randomUUID(),kind:'edible',title:'',qty:1,price:0,size:'',style:'',review:'No Review',customText:''});
const today=()=>new Date().toISOString().slice(0,10);

function notificationCopy(status:string|undefined,enabled:boolean){
  if(!enabled||status==='disabled')return {tone:'#475569',bg:'#f1f5f9',title:'WhatsApp OFF',body:'Order disimpan tanpa notifikasi WhatsApp untuk order ini.'};
  if(status==='rule_disabled')return {tone:'#92400e',bg:'#fef3c7',title:'Order Created rule OFF',body:'Order disimpan tetapi event Order Created sedang disabled.'};
  if(status==='global_disabled')return {tone:'#92400e',bg:'#fef3c7',title:'WhatsApp global OFF',body:'Order disimpan tetapi global WhatsApp sedang OFF.'};
  if(status==='not_queued')return {tone:'#b42318',bg:'#fef3f2',title:'WhatsApp belum beratur',body:'Order disimpan tetapi notifikasi belum masuk queue. Semak WhatsApp Control.'};
  return {tone:'#067647',bg:'#ecfdf3',title:'WhatsApp Auto ON',body:'Order disimpan dan Order Created masuk notification queue.'};
}

export default function ManualOrder({permissions=[],onOpenOrder}:Props){
  const allowed=permissions.includes('create_order');
  const canVerify=permissions.includes('verify_payments');
  const [name,setName]=useState(''); const [phone,setPhone]=useState(''); const [dateNeed,setDateNeed]=useState('');
  const [delivery,setDelivery]=useState('pickup'); const [payment,setPayment]=useState('Unpaid'); const [remark,setRemark]=useState('');
  const [items,setItems]=useState<Item[]>([makeItem()]); const [notify,setNotify]=useState(true);
  const [summary,setSummary]=useState<Summary|null>(null); const [result,setResult]=useState<Result|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null); const [notice,setNotice]=useState<string|null>(null);
  const total=useMemo(()=>items.reduce((sum,i)=>sum+Math.max(1,i.qty)*Math.max(0,i.price),0),[items]);

  useEffect(()=>{void supabase.rpc('icetak_admin_notification_control_summary').then(({data})=>setSummary((data||{}) as Summary));},[]);
  if(!allowed)return <div className="panel"><div className="empty"><div className="empty-title">Permission create_order diperlukan</div></div></div>;

  const update=(id:string,patch:Partial<Item>)=>setItems(old=>old.map(i=>i.id===id?{...i,...patch}:i));
  const submit=async()=>{
    setError(null);setNotice(null);
    const normalized=normalizeMalaysiaPhone(phone);
    if(!name.trim())return setError('Nama customer diperlukan.');
    if(!normalized)return setError('Nombor WhatsApp Malaysia tidak sah.');
    if(!dateNeed)return setError('Date Need diperlukan.');
    if(!items.length||items.some(i=>!i.title.trim()||i.qty<1||i.price<0))return setError('Semak item, qty dan unit price.');
    if(payment==='Paid'&&!canVerify)return setError('Permission verify_payments diperlukan untuk create terus sebagai Paid.');
    setBusy(true);
    const payload={
      customer:{name:name.trim(),phone:normalized,address_line1:'',city:'',postcode:'',state:'',phone_masked:'',address_masked:''},
      items:items.map(i=>({k:i.kind,title:i.title.trim(),process:'Pre-order',review:i.review,size:i.size,style:i.style,customText:i.customText.trim(),price:i.price,qty:i.qty})),
      date_need:dateNeed,delivery,payment,admin_remark:remark.trim(),notify_whatsapp:notify,total,
    };
    const {data,error:rpcError}=await supabase.rpc('icetak_admin_create_order',{p_payload:payload});
    setBusy(false);
    if(rpcError)return setError(rpcError.message);
    setResult((data||{}) as Result);setNotice('Manual order created.');
  };

  const reset=()=>{setName('');setPhone('');setDateNeed('');setDelivery('pickup');setPayment('Unpaid');setRemark('');setItems([makeItem()]);setNotify(true);setResult(null);setError(null);setNotice(null);};
  const summaryText=summary?.global_enabled===false?'Global WhatsApp: OFF':summary?`Global WhatsApp: ON · ${Number(summary.enabled_count||0)}/${Number(summary.total_count||0)} event aktif`:'Loading WhatsApp status…';
  const notifyInfo=result?notificationCopy(result.notification_status,result.notify_whatsapp??notify):null;

  return <div className="fade-in">
    <div className="page-header"><div><div className="page-label">Admin tool</div><h1 className="page-title">Manual Order</h1><p className="page-subtitle">Custom item name + custom unit price. Replacement for V1 Create Customer Order.</p></div></div>
    {notice&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#ecfdf3',color:'#067647',fontWeight:700}}>{notice}</div>}
    {error&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#fef3f2',color:'#b42318'}}>{error}</div>}
    {result&&<div className="panel" style={{marginBottom:14,padding:18}}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><div className="panel-title">Order {result.order_id}</div><div className="panel-subtitle">Total RM {Number(result.total||0).toFixed(2)}</div></div><div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-primary" onClick={()=>onOpenOrder?.(result.order_id)}>Open Order</button><button className="btn btn-outline" onClick={reset}>New Order</button></div></div>{notifyInfo&&<div style={{marginTop:12,padding:12,borderRadius:10,background:notifyInfo.bg,color:notifyInfo.tone}}><b>{notifyInfo.title}</b><div>{notifyInfo.body}</div></div>}</div>}
    <div className="grid-2" style={{alignItems:'start'}}>
      <div className="panel"><div className="panel-header"><div><div className="panel-title">Customer</div><div className="panel-subtitle">{summaryText}</div></div></div><div style={{padding:18,display:'grid',gap:10}}><Field label="Name *"><input value={name} onChange={e=>setName(e.target.value)}/></Field><Field label="WhatsApp Malaysia *"><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0129554732"/></Field><Field label="Date Need *"><input type="date" min={today()} value={dateNeed} onChange={e=>setDateNeed(e.target.value)}/></Field><Field label="Delivery"><select value={delivery} onChange={e=>setDelivery(e.target.value)}><option value="pickup">Pickup</option><option value="spx">SPX</option><option value="jnt">J&T</option><option value="ninja">Ninja Van</option></select></Field><Field label="Payment"><select value={payment} onChange={e=>setPayment(e.target.value)}><option>Unpaid</option>{canVerify&&<option>Paid</option>}<option>Cash Counter</option></select></Field><Field label="Admin Remark"><textarea rows={3} value={remark} onChange={e=>setRemark(e.target.value)}/></Field><label style={{display:'flex',gap:9,alignItems:'flex-start',padding:10,border:'1px solid var(--border-light)',borderRadius:10}}><input type="checkbox" checked={notify} onChange={e=>setNotify(e.target.checked)}/><span><b>Hantar notifikasi WhatsApp untuk order ini</b><div className="cell-sub">Jika OFF, notification order ini dimatikan.</div></span></label></div></div>
      <div><div className="panel"><div className="panel-header"><div><div className="panel-title">Items</div><div className="panel-subtitle">Harga manual seperti V1.</div></div><button className="btn btn-outline" onClick={()=>setItems(old=>[...old,makeItem()])}>+ Add Item</button></div><div style={{padding:14,display:'grid',gap:12}}>{items.map((item,index)=><div key={item.id} style={{border:'1px solid var(--border-light)',borderRadius:12,padding:12}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:9}}><b>Item {index+1}</b><button className="btn btn-outline" disabled={items.length===1} onClick={()=>setItems(old=>old.filter(x=>x.id!==item.id))}>Remove</button></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:8}}><Field label="Product"><select value={item.kind} onChange={e=>update(item.id,{kind:e.target.value as AdminProductKind})}>{(Object.keys(ADMIN_PRODUCTS) as AdminProductKind[]).map(k=><option key={k} value={k}>{ADMIN_PRODUCTS[k].label}</option>)}</select></Field><Field label="Item Name *"><input value={item.title} onChange={e=>update(item.id,{title:e.target.value})}/></Field><Field label="Qty"><input type="number" min={1} value={item.qty} onChange={e=>update(item.id,{qty:Math.max(1,Number(e.target.value||1))})}/></Field><Field label="Unit Price RM"><input type="number" min={0} step="0.01" value={item.price} onChange={e=>update(item.id,{price:Math.max(0,Number(e.target.value||0))})}/></Field><Field label="Size"><input value={item.size} onChange={e=>update(item.id,{size:e.target.value})}/></Field><Field label="Shape / Color"><input value={item.style} onChange={e=>update(item.id,{style:e.target.value})}/></Field><Field label="Review"><select value={item.review} onChange={e=>update(item.id,{review:e.target.value as ProductReview})}><option>No Review</option><option>Need Review</option></select></Field><Field label="Custom Detail"><input value={item.customText} onChange={e=>update(item.id,{customText:e.target.value})}/></Field></div></div>)}</div></div><div className="panel" style={{marginTop:12,padding:18,display:'flex',justifyContent:'space-between',alignItems:'center',gap:12}}><div><div className="cell-sub">Total</div><div style={{fontSize:26,fontWeight:800}}>RM {total.toFixed(2)}</div></div><button className="btn btn-primary" disabled={busy} onClick={()=>void submit()}>{busy?'Creating...':'Create Customer Order'}</button></div></div>
    </div>
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="form-field"><span>{label}</span>{children}</label>;}
