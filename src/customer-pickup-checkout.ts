import { supabase } from './appdeploy-client';
import './customer-pickup-checkout.css';

const QR_URL='https://t3747262.p.clickup-attachments.com/t3747262/836016e0-e613-447b-b61a-291fddd3f83d_large.png';
type Item={id:string;title:string;qty:number;price:number;size?:string;style?:string;wording?:string;previewUrl?:string};
type Order={id:string;orderNo:string;total:number;balance:number;paid:boolean;ready:boolean;collected:boolean;group:string;status:string;dateNeed?:string;items:Item[]};
type Overview={customer:{name:string;phone?:string};orders:Order[]};
type Checkout={checkoutId:string;checkoutNo:string;amount:number;status?:string;paid:boolean;transactionId?:string;expiresAt?:string};

const params=new URLSearchParams(location.search);
const rawPickup=params.get('pickup')||'';
const token=rawPickup==='1'?(params.get('c')||localStorage.getItem('customer_token')||''):rawPickup;
const app=document.getElementById('app');
const selected=new Set<string>();
let overview:Overview|null=null;
let checkout:Checkout|null=null;
let pollTimer=0;

const money=(value:number)=>`RM ${Number(value||0).toFixed(2)}`;
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]||char));
const isSelectable=(order:Order)=>!order.paid&&!order.collected;

async function rpc<T>(name:string,args:Record<string,unknown>){
  const {data,error}=await supabase.rpc(name,args as never);
  if(error)throw error;
  return data as T;
}

function orderHtml(order:Order){
  const checked=selected.has(order.id)?' checked':'';
  const preview=(item:Item)=>item.previewUrl
    ?`<button type="button" class="cp-preview-trigger" data-preview-src="${escapeHtml(item.previewUrl)}" data-preview-title="${escapeHtml(item.title)}"><img src="${escapeHtml(item.previewUrl)}" alt="" loading="lazy"></button>`
    :'<div class="cp-item-placeholder">ITEM</div>';
  return `<article class="cp-order ${order.ready?'ready':'processing'} ${order.paid?'paid':''}">
    <div class="cp-order-head">
      ${isSelectable(order)?`<input type="checkbox" data-pay-order="${order.id}"${checked}>`:'<span class="cp-check">✓</span>'}
      <div><b>${escapeHtml(order.orderNo)}</b><small>${escapeHtml(order.status)}</small></div>
      <div class="cp-tags"><span class="${order.ready?'ready':'processing'}">${order.ready?'READY PICKUP':'PROCESSING'}</span><span class="${order.paid?'paid':'unpaid'}">${order.paid?'PAID':'UNPAID'}</span></div>
      <strong>${money(order.paid?order.total:order.balance)}</strong>
    </div>
    <div class="cp-items">${order.items.map((item)=>`<div class="cp-item">${preview(item)}<div><b>${item.qty}× ${escapeHtml(item.title)}</b><small>${escapeHtml([item.size,item.style,item.wording].filter(Boolean).join(' · ')||'Order item')}</small></div><span>${money(Number(item.qty||1)*Number(item.price||0))}</span></div>`).join('')}</div>
    ${!order.ready&&isSelectable(order)&&selected.has(order.id)?'<p class="cp-warning">Bayaran awal sahaja. Item ini masih belum boleh diambil.</p>':''}
  </article>`;
}

function render(){
  if(!app)return;
  if(!overview){
    app.innerHTML='<main class="cp-shell"><div class="cp-loading"><span></span> Loading Pickup & Payment…</div></main>';
    return;
  }
  const ready=overview.orders.filter((order)=>order.group==='ready_unpaid'||order.group==='ready_paid');
  const processing=overview.orders.filter((order)=>order.group==='processing_unpaid'||order.group==='processing_paid');
  const chosen=overview.orders.filter((order)=>selected.has(order.id));
  const total=chosen.reduce((sum,order)=>sum+Number(order.balance||0),0);
  const waiting=checkout&&!checkout.paid;
  app.innerHTML=`<main class="cp-shell">
    <header class="cp-header"><div class="cp-logo">DecoCake.my</div><span>Pickup & Payment</span></header>
    <section class="cp-hero"><span>WELCOME</span><h1>Hi, ${escapeHtml(overview.customer.name)}</h1><p>Pilih order yang hendak dibayar. Order ready dipilih secara automatik; order processing boleh dibayar awal tetapi belum boleh diambil.</p></section>
    ${checkout?`<section class="cp-payment ${checkout.paid?'paid':''}"><div><span>${checkout.paid?'PAYMENT SUCCESSFUL':'SCAN & PAY EXACT AMOUNT'}</span><h2>${escapeHtml(checkout.checkoutNo)}</h2><button type="button" class="cp-amount-copy" data-copy-amount><strong>${money(checkout.amount)}</strong><small>Tap to copy</small></button><p>${checkout.paid?`Semua order yang dipilih telah PAID. Transaction: ${escapeHtml(checkout.transactionId||'matched')}`:'Halaman ini semak bayaran secara automatik setiap 4 saat.'}</p></div>${waiting?`<div class="cp-payment-visual"><img src="${QR_URL}" alt="QRPay DecoCake.my"><div class="cp-qr-actions"><a href="${QR_URL}" target="_blank" rel="noopener" download="icetak-duitnow-qr.png">Save QR</a><button type="button" data-copy-amount>Copy Amount</button></div></div>`:'<div class="cp-paid-check">✓</div>'}</section>`:''}
    <section class="cp-section"><div class="cp-section-title"><div><h2>Siap untuk pickup</h2><p>Barang ini sudah selesai diproses.</p></div><b>${ready.length}</b></div>
      ${ready.length?ready.map(orderHtml).join(''):'<div class="cp-empty">Belum ada order yang siap.</div>'}
    </section>
    <section class="cp-section"><div class="cp-section-title"><div><h2>Masih dalam proses</h2><p>Boleh bayar awal, tetapi tunggu notifikasi ready sebelum datang.</p></div><b>${processing.length}</b></div>
      ${processing.length?processing.map(orderHtml).join(''):'<div class="cp-empty">Tiada order sedang diproses.</div>'}
    </section>
    <aside class="cp-summary">
      <div><span>${chosen.length} ORDER DIPILIH</span><strong>${money(total)}</strong></div>
      <button id="cp-pay" ${!chosen.length||waiting?'disabled':''}>${waiting?'Menunggu QRPay…':'Bayar Sekali dengan QRPay'}</button>
      <small>Jumlah penuh sahaja. Status produksi setiap order tidak akan berubah selepas bayaran.</small>
    </aside>
  </main>`;
  app.querySelectorAll<HTMLInputElement>('[data-pay-order]').forEach((input)=>{
    input.addEventListener('change',()=>{
      const id=input.dataset.payOrder||'';
      if(input.checked)selected.add(id);else selected.delete(id);
      checkout=null;if(pollTimer)window.clearInterval(pollTimer);render();
    });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-preview-src]').forEach((button)=>{
    button.addEventListener('click',()=>openPreview(button.dataset.previewSrc||'',button.dataset.previewTitle||''));
  });
  app.querySelectorAll<HTMLButtonElement>('[data-copy-amount]').forEach((button)=>{
    button.addEventListener('click',()=>void copyAmount(checkout?.amount||0));
  });
  document.getElementById('cp-pay')?.addEventListener('click',()=>void createCheckout());
}

function openPreview(src:string,title:string){
  if(!src)return;
  const wrap=document.createElement('div');
  wrap.className='cp-lightbox';
  wrap.innerHTML=`<button type="button" class="cp-lightbox-close" aria-label="Close image">×</button><img src="${escapeHtml(src)}" alt="${escapeHtml(title)}">`;
  const close=()=>{wrap.remove();window.removeEventListener('keydown',onKey);};
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
  wrap.addEventListener('mousedown',(event)=>{if(event.target===wrap)close();});
  wrap.querySelector('button')?.addEventListener('click',close);
  window.addEventListener('keydown',onKey);
  document.body.append(wrap);
}

async function copyAmount(amount:number){
  if(!amount)return;
  try{
    await navigator.clipboard.writeText(Number(amount).toFixed(2));
    document.querySelector('.cp-copy-toast')?.remove();
    const toast=document.createElement('div');
    toast.className='cp-copy-toast';
    toast.textContent='Amount copied';
    document.body.append(toast);
    window.setTimeout(()=>toast.remove(),1800);
  }catch{/* clipboard permissions vary by browser */}
}

async function load(){
  if(!token)throw new Error('Pickup link tidak lengkap.');
  overview=await rpc<Overview>('icetak_customer_pickup_overview',{p_token:token});
  if(!selected.size)overview.orders.filter((order)=>order.group==='ready_unpaid').forEach((order)=>selected.add(order.id));
  render();
}

async function createCheckout(){
  if(!selected.size)return;
  const button=document.getElementById('cp-pay') as HTMLButtonElement|null;
  if(button){button.disabled=true;button.textContent='Menyediakan QRPay…';}
  try{
    checkout=await rpc<Checkout>('icetak_customer_create_pickup_checkout',{p_token:token,p_order_ids:Array.from(selected)});
    render();startPolling();
  }catch(error:any){
    alert(error?.message==='payment_amount_in_use'
      ?'Jumlah sama sedang digunakan pelanggan lain. Cuba semula selepas beberapa minit.'
      :error?.message||'Tidak dapat cipta QRPay.');
    render();
  }
}

function startPolling(){
  if(!checkout||checkout.paid)return;
  if(pollTimer)window.clearInterval(pollTimer);
  pollTimer=window.setInterval(async()=>{
    if(!checkout)return;
    try{
      checkout=await rpc<Checkout>('icetak_pickup_checkout_status',{p_token:token,p_checkout_id:checkout.checkoutId});
      if(checkout.paid){
        window.clearInterval(pollTimer);
        overview=await rpc<Overview>('icetak_customer_pickup_overview',{p_token:token});
        selected.clear();render();
      }else if(checkout.status==='expired'||checkout.status==='cancelled'||(checkout.expiresAt&&new Date(checkout.expiresAt).getTime()<=Date.now())){
        window.clearInterval(pollTimer);
        checkout=null;
        render();
      }
    }catch{/* transient polling errors do not replace the payment screen */}
  },4000);
}

render();
void load().catch((error)=>{
  const message=error?.message==='invalid_or_expired_pickup_link'?'Link pickup tidak sah atau telah tamat.':error?.message||'Link pickup tidak sah atau telah tamat.';
  if(app)app.innerHTML=`<main class="cp-shell"><div class="cp-error"><h2>Link tidak dapat dibuka</h2><p>${escapeHtml(message)}</p></div></main>`;
});
