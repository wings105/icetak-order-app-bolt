import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconSearch } from '../components/Icons';
import './PickupCounter.css';

const QR_URL = 'https://t3747262.p.clickup-attachments.com/t3747262/836016e0-e613-447b-b61a-291fddd3f83d_large.png';

type PickupItem = {
  id:string; title:string; kind?:string; qty:number; price:number;
  size?:string; style?:string; wording?:string; previewUrl?:string;
};
type PickupOrder = {
  id:string; orderNo:string; orderToken?:string; total:number; balance:number;
  paid:boolean; ready:boolean; collected:boolean;
  group:'ready_unpaid'|'ready_paid'|'processing_unpaid'|'processing_paid'|'collected';
  status:string; dateNeed?:string; createdAt:string; paymentMethod?:string; items:PickupItem[];
};
type Overview = {
  ok:boolean;
  customer:{id:string;name:string;phone?:string;bsuid?:string};
  orders:PickupOrder[];
  generatedAt:string;
};
type QueueOrder = {id:string;orderNo:string;amount:number;previewUrl?:string;itemTitle?:string;dateNeed?:string};
type SearchRow = {
  id:string;name:string;phone?:string;bsuid?:string;
  readyUnpaid:number;readyAmount:number;readyOrders?:QueueOrder[];
  nextDue?:string;latestReadyAt?:string;
};
type ReadyQueue = {ok:boolean;rows:SearchRow[];orderCount:number;totalAmount:number};
type Checkout = {
  ok:boolean; paid:boolean; checkoutId:string; checkoutNo:string;
  amount:number; paymentSessionId?:string; expiresAt?:string; transactionId?:string;
  reused?:boolean;status?:string;
};
type Props = {
  permissions?:string[];
  initialCustomer?:string;
  onOpenOrder?:(orderNo:string)=>void;
};

const money=(value:number)=>`RM ${Number(value||0).toFixed(2)}`;
const GROUPS: Array<{key:PickupOrder['group'];label:string;hint:string}> = [
  {key:'ready_unpaid',label:'Ready · Belum Bayar',hint:'Dipilih automatik untuk pickup hari ini'},
  {key:'ready_paid',label:'Ready · Sudah Bayar',hint:'Boleh terus dipilih untuk handover'},
  {key:'processing_unpaid',label:'Masih Diproses · Belum Bayar',hint:'Boleh bayar awal, tetapi belum boleh ambil'},
  {key:'processing_paid',label:'Masih Diproses · Sudah Bayar',hint:'Tunggu siap sebelum handover'},
  {key:'collected',label:'Sudah Diambil',hint:'Rekod handover terdahulu'},
];

async function rpc<T>(name:string,args:Record<string,unknown>={}){
  const {data,error}=await supabase.rpc(name,args as never);
  if(error)throw error;
  return data as T;
}

function OrderCard({
  order,paySelected,handoverSelected,onPayToggle,onHandoverToggle,onOpenOrder,onPreview,
}:{
  order:PickupOrder;paySelected:boolean;handoverSelected:boolean;
  onPayToggle:(id:string)=>void;onHandoverToggle:(id:string)=>void;
  onOpenOrder?:(orderNo:string)=>void;
  onPreview:(src:string,title:string)=>void;
}){
  const canPay=!order.paid&&!order.collected;
  const canHandover=order.paid&&order.ready&&!order.collected;
  return <article className={`pickup-order-card ${order.ready?'ready':'processing'} ${order.paid?'paid':''}`}>
    <div className="pickup-order-head">
      <div className="pickup-select">
        {canPay?<input aria-label={`Bayar ${order.orderNo}`} type="checkbox" checked={paySelected} onChange={()=>onPayToggle(order.id)}/>
          :canHandover?<input aria-label={`Serah ${order.orderNo}`} type="checkbox" checked={handoverSelected} onChange={()=>onHandoverToggle(order.id)}/>
          :<span className="pickup-lock">✓</span>}
      </div>
      <button className="pickup-order-link" onClick={()=>onOpenOrder?.(order.orderNo)}>{order.orderNo}</button>
      <span className={`pickup-state ${order.ready?'ready':'processing'}`}>{order.ready?'READY PICKUP':'PROCESSING'}</span>
      <span className={`pickup-state ${order.paid?'paid':'unpaid'}`}>{order.paid?'PAID':'UNPAID'}</span>
      <strong>{money(order.paid?order.total:order.balance)}</strong>
    </div>
    <div className="pickup-order-status">{order.status}{order.dateNeed?` · Need ${new Date(order.dateNeed).toLocaleDateString('en-MY')}`:''}</div>
    <div className="pickup-items">
      {order.items.map((item)=><div key={item.id} className="pickup-item">
        {item.previewUrl?<button type="button" className="pickup-preview-trigger" onClick={()=>onPreview(item.previewUrl!,item.title)} aria-label={`Preview ${item.title}`}><img src={item.previewUrl} alt="" loading="lazy"/></button>:<div className="pickup-item-placeholder">ITEM</div>}
        <div><b>{item.qty}× {item.title}</b><small>{[item.size,item.style,item.wording].filter(Boolean).join(' · ')||'Tiada detail tambahan'}</small></div>
        <span>{money(Number(item.qty||1)*Number(item.price||0))}</span>
      </div>)}
    </div>
    {!order.ready&&canPay&&paySelected?<div className="pickup-warning">Bayaran awal sahaja — barang ini masih tidak boleh diserahkan.</div>:null}
  </article>;
}

function QueueCard({row,onOpen}:{row:SearchRow;onOpen:(id:string)=>void}){
  const previewOrders=(row.readyOrders||[]).slice(0,4);
  return <button type="button" className="pickup-queue-card" onClick={()=>onOpen(row.id)}>
    <div className="pickup-queue-card-top">
      <div className="pickup-queue-identity"><strong>{row.name}</strong><span>{row.phone||row.bsuid||'No phone'}</span></div>
      <span className="pickup-queue-count">{row.readyUnpaid} READY</span>
    </div>
    <div className="pickup-queue-orders">
      {previewOrders.map((order)=><div key={order.id} className="pickup-queue-order">
        {order.previewUrl?<img src={order.previewUrl} alt="" loading="lazy"/>:<span className="pickup-queue-placeholder">{(order.itemTitle||'ITEM').slice(0,1)}</span>}
        <div><b>{order.orderNo}</b><small>{order.itemTitle||'Pickup order'}</small></div>
        <span>{money(order.amount)}</span>
      </div>)}
      {row.readyUnpaid>previewOrders.length?<div className="pickup-queue-more">+{row.readyUnpaid-previewOrders.length} lagi</div>:null}
    </div>
    <div className="pickup-queue-footer"><span>BELUM BAYAR</span><strong>{money(row.readyAmount)}</strong></div>
  </button>;
}

export default function PickupCounter({permissions=[],initialCustomer='',onOpenOrder}:Props){
  const canPay=permissions.includes('verify_payments');
  const canHandover=canPay||permissions.includes('approve_production');
  const [query,setQuery]=useState('');
  const [searchRows,setSearchRows]=useState<SearchRow[]>([]);
  const [queue,setQueue]=useState<ReadyQueue|null>(null);
  const [searched,setSearched]=useState(false);
  const [overview,setOverview]=useState<Overview|null>(null);
  const [paySelected,setPaySelected]=useState<Set<string>>(new Set());
  const [handoverSelected,setHandoverSelected]=useState<Set<string>>(new Set());
  const [checkoutReadyIds,setCheckoutReadyIds]=useState<string[]>([]);
  const [checkout,setCheckout]=useState<Checkout|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [preview,setPreview]=useState<{src:string;title:string}|null>(null);

  const loadQueue=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const data=await rpc<ReadyQueue>('icetak_admin_pickup_ready_queue',{p_limit:80});
      setQueue(data);
    }catch(err:any){setError(err?.message||'Gagal load ready pickup queue');}
    finally{setLoading(false);}
  },[]);

  const loadOverview=useCallback(async(id:string,keepSelection=false)=>{
    if(!id)return;
    setLoading(true);setError('');
    try{
      const data=await rpc<Overview>('icetak_admin_pickup_customer_overview',{p_customer_master_id:id});
      setOverview(data);setSearchRows([]);setSearched(false);
      if(!keepSelection){
        setPaySelected(new Set(data.orders.filter((order)=>order.group==='ready_unpaid').map((order)=>order.id)));
        setHandoverSelected(new Set());
      }
    }catch(err:any){setError(err?.message||'Gagal load pickup customer');}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{
    if(initialCustomer)void loadOverview(initialCustomer);
    else void loadQueue();
  },[initialCustomer,loadOverview,loadQueue]);

  useEffect(()=>{
    if(!preview)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setPreview(null);};
    window.addEventListener('keydown',close);
    return()=>window.removeEventListener('keydown',close);
  },[preview]);

  const search=async()=>{
    if(!query.trim()){
      setOverview(null);setSearchRows([]);setSearched(false);setCheckout(null);
      await loadQueue();
      return;
    }
    setLoading(true);setError('');setOverview(null);setCheckout(null);
    try{
      const data=await rpc<{ok:boolean;rows:SearchRow[]}>('icetak_admin_pickup_customer_search',{p_query:query,p_limit:20});
      const rows=(data.rows||[]).sort((left,right)=>right.readyUnpaid-left.readyUnpaid||right.readyAmount-left.readyAmount||left.name.localeCompare(right.name));
      const ready=rows.filter((row)=>row.readyUnpaid>0);
      const visible=ready.length?ready:rows;
      setSearchRows(visible);setSearched(true);
      if(visible.length===1)await loadOverview(visible[0].id);
    }catch(err:any){setError(err?.message||'Carian gagal');setLoading(false);}
    finally{setLoading(false);}
  };

  const toggle=(setter:React.Dispatch<React.SetStateAction<Set<string>>>,id:string)=>{
    setter((current)=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  };
  const selectedOrders=useMemo(()=>overview?.orders.filter((order)=>paySelected.has(order.id))||[],[overview,paySelected]);
  const payTotal=useMemo(()=>selectedOrders.reduce((sum,order)=>sum+Number(order.balance||0),0),[selectedOrders]);
  const hasProcessing=selectedOrders.some((order)=>!order.ready);

  const refresh=async()=>{
    if(overview)await loadOverview(overview.customer.id,true);
    else await loadQueue();
  };

  const createCheckout=async(method:'cash'|'qrpay')=>{
    if(!overview||paySelected.size===0)return;
    if(!canPay){setError('Permission verify_payments diperlukan.');return;}
    setBusy(method);setError('');setNotice('');
    const readyIds=selectedOrders.filter((order)=>order.ready).map((order)=>order.id);
    try{
      const data=await rpc<Checkout>('icetak_admin_create_pickup_checkout',{
        p_customer_master_id:overview.customer.id,
        p_order_ids:Array.from(paySelected),
        p_method:method,p_source:'counter',
      });
      setCheckout(data);
      setCheckoutReadyIds(readyIds);
      setNotice(method==='cash'
        ? `Bayaran cash ${money(data.amount)} sudah direkod untuk ${paySelected.size} order.`
        : data.reused
          ? `QRPay ${money(data.amount)} sedia ada disambung semula. Tunggu transaksi dipadankan.`
          : `QRPay ${money(data.amount)} sudah disediakan. Tunggu transaksi dipadankan.`);
      if(method==='cash'){
        setPaySelected(new Set());
        setHandoverSelected(new Set(readyIds));
        await loadOverview(overview.customer.id,true);
        void loadQueue();
      }
    }catch(err:any){setError(err?.message==='payment_amount_in_use'
      ? 'Jumlah QR yang sama sedang digunakan checkout lain. Tunggu sesi itu tamat atau guna cash.'
      :err?.message||'Checkout gagal');}
    finally{setBusy('');}
  };

  const activeCheckoutId=checkout?.checkoutId||'';
  const activeCheckoutPaid=checkout?.paid||false;
  const activeCustomerId=overview?.customer.id||'';
  useEffect(()=>{
    if(!activeCheckoutId||activeCheckoutPaid)return;
    const timer=window.setInterval(async()=>{
      try{
        const status=await rpc<Checkout>('icetak_admin_pickup_checkout_status',{p_checkout_id:activeCheckoutId});
        setCheckout(status);
        if(status.paid&&activeCustomerId){
          setNotice(`QRPay matched: ${status.transactionId||status.checkoutNo}. Semua order dipilih sudah PAID.`);
          setPaySelected(new Set());
          setHandoverSelected(new Set(checkoutReadyIds));
          void loadOverview(activeCustomerId,true);
          void loadQueue();
        }else if(status.status==='expired'||status.status==='cancelled'||(status.expiresAt&&Date.parse(status.expiresAt)<=Date.now())){
          setCheckout(null);
          setNotice('Sesi QR sudah tamat. Boleh generate semula.');
        }
      }catch{/* keep polling until staff leaves the page */}
    },4000);
    return()=>window.clearInterval(timer);
  },[activeCheckoutId,activeCheckoutPaid,activeCustomerId,checkoutReadyIds,loadOverview,loadQueue]);

  const handover=async()=>{
    if(!overview||handoverSelected.size===0||!canHandover)return;
    setBusy('handover');setError('');
    try{
      const result=await rpc<{handoverNo:string;orderCount:number}>('icetak_admin_pickup_handover',{
        p_customer_master_id:overview.customer.id,
        p_order_ids:Array.from(handoverSelected),
        p_checkout_id:checkout?.paid?checkout.checkoutId:null,
        p_notes:null,
      });
      setNotice(`${result.handoverNo}: ${result.orderCount} order berjaya diserah kepada customer.`);
      setCheckout(null);setCheckoutReadyIds([]);await loadOverview(overview.customer.id);void loadQueue();
    }catch(err:any){setError(err?.message||'Handover gagal');}
    finally{setBusy('');}
  };

  const prepareMessage=async()=>{
    if(!overview)throw new Error('Customer belum dipilih.');
    const access=await rpc<{path:string}>('icetak_admin_create_pickup_access',{p_customer_master_id:overview.customer.id});
    const link=new URL(access.path,window.location.origin).toString();
    const ready=overview.orders.filter((order)=>order.group==='ready_unpaid');
    const total=ready.reduce((sum,order)=>sum+Number(order.balance||0),0);
    const lines=ready.flatMap((order)=>[
      `• ${order.orderNo} — ${money(order.balance)}`,
      ...order.items.map((item)=>`   ${item.qty}× ${item.title}${item.size?` (${item.size})`:''}`),
    ]);
    const message=[
      `Hi ${overview.customer.name},`,'',
      ready.length?`${ready.length} order anda sudah siap untuk pickup:`:'Semak status order pickup anda:',
      ...lines,'',ready.length?`Jumlah perlu dibayar: *${money(total)}*`:'',
      'Pilih item dan buat bayaran QRPay melalui link ini:',link,
    ].filter(Boolean).join('\n');
    return{link,message,ready,total,lines};
  };

  const createLink=async(copyMessage=false)=>{
    if(!overview)return;
    setBusy('link');setError('');
    try{
      const {link,message}=await prepareMessage();
      await navigator.clipboard.writeText(copyMessage?message:link);
      setNotice(copyMessage?'Mesej WhatsApp gabungan sudah disalin.':'Link Pickup & Payment sudah disalin.');
    }catch(err:any){setError(err?.message||'Gagal cipta link');}
    finally{setBusy('');}
  };

  const sendWhatsApp=async()=>{
    if(!overview)return;
    if(!overview.customer.phone&&!overview.customer.bsuid){setError('Customer ini tiada nombor WhatsApp atau BSUID.');return;}
    setBusy('whatsapp');setError('');setNotice('');
    try{
      const {link,message,ready,total,lines}=await prepareMessage();
      const payload={
        phone:overview.customer.phone||undefined,
        bsuid:overview.customer.bsuid||undefined,
        event_type:'pickup_payment_summary',
        source:'pickup_counter',
        text:message,
        vars:{
          customer_name:overview.customer.name,
          phone:overview.customer.phone||'',
          order_id:ready.map((order)=>order.orderNo).join(', ')||'Pickup orders',
          order_total:money(total),
          payment_link:link,
          order_link:link,
          items_summary:lines.join('\n'),
          pickup_order_count:String(ready.length),
          pickup_location:'Bandar Baru Pasir Puteh',
        },
      };
      const {data,error:sendError}=await supabase.functions.invoke('whatsapp-send',{body:payload});
      if(sendError){
        const details=await (sendError as {context?:Response}).context?.json().catch(()=>null);
        throw new Error(details?.error||sendError.message||'Penghantaran WhatsApp gagal.');
      }
      if(data?.ok===false)throw new Error(data.error||'Penghantaran WhatsApp gagal.');
      setNotice(`WhatsApp berjaya dihantar${data?.mode?` melalui ${data.mode==='text'?'free-form':'approved template'}`:''}.`);
    }catch(err:any){setError(err?.message||'Penghantaran WhatsApp gagal.');}
    finally{setBusy('');}
  };

  const copyAmount=async(amount:number)=>{
    try{
      await navigator.clipboard.writeText(Number(amount).toFixed(2));
      setNotice(`Jumlah ${money(amount)} disalin.`);
    }catch{setError('Tidak dapat salin jumlah.');}
  };

  const resetToQueue=()=>{
    setOverview(null);setSearchRows([]);setSearched(false);setCheckout(null);
    setCheckoutReadyIds([]);setQuery('');setError('');setNotice('');
    void loadQueue();
  };

  return <div className="pickup-page fade-in">
    <div className="page-header">
      <div><h1 className="page-title">Pickup Counter</h1><p className="page-subtitle">Customer ready pickup, satu bayaran dan secure handover.</p></div>
      <button className="btn btn-outline" disabled={loading} onClick={()=>void refresh()}><IconRefresh size={16}/> Refresh</button>
    </div>
    <form className="pickup-search" onSubmit={(event)=>{event.preventDefault();void search();}}>
      <IconSearch size={19}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Cari nama, telefon atau order ID"/>
      <button className="btn btn-primary" disabled={loading}>{loading?'Loading…':'Cari Customer'}</button>
    </form>
    {error?<div className="pickup-alert error">{error}</div>:null}
    {notice?<div className="pickup-alert success">{notice}</div>:null}

    {!overview&&searchRows.length>0?<section className="pickup-queue-section">
      <div className="pickup-queue-heading"><div><h2>Hasil carian</h2><p>Ready pickup dan belum bayar dipaparkan dahulu.</p></div><button type="button" className="btn btn-outline" onClick={resetToQueue}>Semua Ready</button></div>
      <div className="pickup-queue-grid">{searchRows.map((row)=><QueueCard key={row.id} row={row} onOpen={(id)=>void loadOverview(id)}/>)}</div>
    </section>:null}

    {!overview&&!searched&&!searchRows.length?<section className="pickup-queue-section">
      <div className="pickup-queue-heading"><div><h2>Ready · Belum Bayar</h2><p>{queue?.rows.length||0} customer · {queue?.orderCount||0} order siap</p></div><strong>{money(queue?.totalAmount||0)}</strong></div>
      {queue?.rows.length?<div className="pickup-queue-grid">{queue.rows.map((row)=><QueueCard key={row.id} row={row} onOpen={(id)=>void loadOverview(id)}/>)}</div>
        :loading?<div className="pickup-queue-empty">Loading pickup queue…</div>:<div className="pickup-queue-empty">Tiada order ready yang belum dibayar.</div>}
    </section>:null}

    {!overview&&searched&&!searchRows.length?<div className="pickup-queue-empty">Tiada customer atau order yang sepadan.</div>:null}

    {overview?<>
      <section className="pickup-customer">
        <div><button type="button" className="pickup-back" onClick={resetToQueue}>← Ready Queue</button><span>Customer</span><h2>{overview.customer.name}</h2><p>{overview.customer.phone?'+'.concat(overview.customer.phone.replace(/^\+/,'')):overview.customer.bsuid||'No phone linked'}</p></div>
        <div className="pickup-customer-actions">
          <button className="btn btn-outline" disabled={busy!==''} onClick={()=>void createLink(false)}>Copy Link</button>
          <button className="btn btn-outline" disabled={busy!==''} onClick={()=>void createLink(true)}>Copy Text</button>
          <button className="btn pickup-whatsapp-action" disabled={busy!==''||(!overview.customer.phone&&!overview.customer.bsuid)} onClick={()=>void sendWhatsApp()}>{busy==='whatsapp'?'Menghantar…':'Hantar WhatsApp'}</button>
        </div>
      </section>

      <div className="pickup-layout">
        <div className="pickup-order-groups">
          {GROUPS.map((group)=>{
            const orders=overview.orders.filter((order)=>order.group===group.key);
            if(!orders.length)return null;
            return <section key={group.key} className="pickup-group">
              <div className="pickup-group-title"><div><h3>{group.label}</h3><p>{group.hint}</p></div><span>{orders.length}</span></div>
              {orders.map((order)=><OrderCard key={order.id} order={order}
                paySelected={paySelected.has(order.id)} handoverSelected={handoverSelected.has(order.id)}
                onPayToggle={(id)=>toggle(setPaySelected,id)} onHandoverToggle={(id)=>toggle(setHandoverSelected,id)}
                onOpenOrder={onOpenOrder} onPreview={(src,title)=>setPreview({src,title})}/>)}
            </section>;
          })}
          {overview.orders.length===0?<div className="empty"><div className="empty-title">Tiada pickup order</div><p>Customer ini belum mempunyai order pickup aktif.</p></div>:null}
        </div>

        <aside className="pickup-summary">
          <span className="pickup-summary-label">PAYMENT SELECTION</span>
          <h3>{paySelected.size} order</h3>
          <div className="pickup-summary-total"><span>Jumlah penuh</span><strong>{money(payTotal)}</strong></div>
          {selectedOrders.map((order)=><div className="pickup-summary-line" key={order.id}><span>{order.orderNo}{!order.ready?' · PROCESSING':''}</span><b>{money(order.balance)}</b></div>)}
          {hasProcessing?<div className="pickup-warning">Ada order belum siap dipilih. Ia akan menjadi PAID, tetapi kekal PROCESSING dan tidak boleh handover.</div>:null}
          <button className="btn btn-primary pickup-main-action" disabled={!canPay||!paySelected.size||busy!==''} onClick={()=>void createCheckout('qrpay')}>{busy==='qrpay'?'Menyediakan…':'Generate 1 QRPay'}</button>
          <button className="btn btn-outline pickup-main-action" disabled={!canPay||!paySelected.size||busy!==''} onClick={()=>void createCheckout('cash')}>{busy==='cash'?'Merekod…':'Confirm Full Cash Payment'}</button>
          <div className="pickup-divider"/>
          <span className="pickup-summary-label">SECURE HANDOVER</span>
          <p>{handoverSelected.size} ready + paid order dipilih.</p>
          <button className="btn btn-dark pickup-main-action" disabled={!canHandover||!handoverSelected.size||busy!==''} onClick={()=>void handover()}>{busy==='handover'?'Mengesahkan…':'Confirm Barang Diserah'}</button>
        </aside>
      </div>

      {checkout&&checkout.checkoutId?<section className={`pickup-checkout ${checkout.paid?'paid':''}`}>
        <div>
          <span>{checkout.paid?'PAYMENT MATCHED':'WAITING FOR QRPAY'}</span>
          <h2>{checkout.checkoutNo}</h2><button type="button" className="pickup-copy-amount" onClick={()=>void copyAmount(checkout.amount)}><strong>{money(checkout.amount)}</strong><small>Copy Amount</small></button>
          <p>{checkout.paid?`Transaction: ${checkout.transactionId||'matched'}`:'Minta customer scan QR dan bayar jumlah tepat. Sistem refresh setiap 4 saat.'}</p>
          {!checkout.paid?<div className="pickup-qr-actions"><button type="button" onClick={()=>void copyAmount(checkout.amount)}>Copy Amount</button><a href={QR_URL} target="_blank" rel="noopener" download="icetak-duitnow-qr.png">Save QR</a></div>:null}
        </div>
        {!checkout.paid?<img src={QR_URL} alt="QRPay iCetak"/>:<div className="pickup-paid-check">✓</div>}
      </section>:null}
    </>:null}

    {preview?<div className="pickup-lightbox" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setPreview(null);}}>
      <button type="button" className="pickup-lightbox-close" onClick={()=>setPreview(null)} aria-label="Close image">×</button>
      <img src={preview.src} alt={preview.title}/>
    </div>:null}
  </div>;
}
