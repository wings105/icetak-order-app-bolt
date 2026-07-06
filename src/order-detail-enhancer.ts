import { supabase } from './appdeploy-client';

const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
const money = (n: any) => `RM${Number(n || 0).toFixed(Number.isInteger(Number(n || 0)) ? 0 : 2)}`;
const paid = (o: any) => ['paid', 'matched', 'confirmed'].includes(String(o.payment_status || '').toLowerCase()) || String(o.status || '').toLowerCase() === 'payment_received';

function style() {
  if (document.querySelector('#od-lite-style')) return;
  const s = document.createElement('style');
  s.id = 'od-lite-style';
  s.textContent = `.od{max-width:720px;margin:24px auto;padding:0 14px}.od-card{background:#fff;border-radius:14px;padding:16px;margin:12px 0;box-shadow:0 1px 0 #e5e7eb}.od-head{display:flex;justify-content:space-between;gap:12px}.od-pill{background:#eef2ff;border-radius:999px;padding:7px 11px;height:fit-content;font-size:12px}.od-bar{height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden}.od-bar i{display:block;height:100%;background:#ee4d2d}.od-item{border-top:1px solid #eef2f7;padding:12px 0;display:flex;justify-content:space-between;gap:10px}.od-muted{color:#64748b}.od-pay{border:1px solid #fecaca;background:#fff7f7}.od-pay.paid{border-color:#86efac;background:#ecfdf5}.od-btn{display:block;width:100%;border:0;border-radius:10px;padding:14px;background:#ee4d2d;color:#fff;font-weight:800;text-align:center;text-decoration:none}`;
  document.head.append(s);
}

function ref() {
  const token = new URLSearchParams(location.search).get('order');
  if (token) return { col: 'public_token', val: token };
  const m = (document.querySelector('#app')?.textContent || '').match(/ICT-\d{8}-[A-Z0-9]+/);
  return m ? { col: 'order_no', val: m[0] } : null;
}

async function load(r: { col: string; val: string }) {
  const q = supabase.from('orders').select('*').limit(1);
  const { data: orders } = r.col === 'public_token' ? await q.eq('public_token', r.val) : await q.eq('order_no', r.val);
  const o = orders?.[0];
  if (!o) return null;
  const [items, sessions] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', o.id).order('created_at', { ascending: true }),
    supabase.from('payment_sessions').select('*').eq('order_id', o.id).order('created_at', { ascending: false }).limit(5),
  ]);
  return { o, items: items.data || [], sessions: sessions.data || [] };
}

function render(d: any) {
  style();
  const o = d.o, isPaid = paid(o), s = d.sessions.find((x: any) => x.status === 'matched') || d.sessions[0];
  const pct = isPaid ? 20 : 0;
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  app.innerHTML = `<header class="checkout-head"><button id="odBack">‹</button><h1>Order Detail</h1></header><main class="od"><section class="od-card od-head"><div><small>Order ID</small><h2>${esc(o.order_no)}</h2><p>Date Need ${esc(o.date_need || '')}</p><b>${esc(o.delivery_name || 'Customer')}</b><br><span class="od-muted">${esc(o.delivery_phone || '')}</span><br><span class="od-muted">${o.delivery_method === 'pickup' ? '📍 Pickup — Bandar Baru Pasir Puteh' : esc([o.delivery_address, o.delivery_postcode, o.delivery_city, o.delivery_state].filter(Boolean).join(', '))}</span></div><span class="od-pill">${isPaid ? 'In Production' : 'Waiting Payment'}</span></section><section class="od-card"><b>Overall Progress</b><span style="float:right">${pct}% • ${d.items.length} item</span><div class="od-bar"><i style="width:${pct}%"></i></div></section><section class="od-card"><b>Item & Production Tracking</b>${d.items.map((i: any, n: number) => `<div class="od-item"><div><small>Item ${n + 1}</small><b>${Number(i.qty || 1)}× ${esc(i.title)}</b><br><span class="od-muted">${esc(i.size || '')} • ${esc(i.style || '')}</span><br><span>Order Received</span></div><strong>${money(Number(i.price || 0) * Number(i.qty || 1))}</strong></div>`).join('')}</section><section class="od-card od-pay ${isPaid ? 'paid' : ''}"><b>Payment: ${isPaid ? 'Paid ✅' : 'Unpaid'}</b><p>${isPaid ? 'Bayaran telah diterima.' : 'Selesaikan bayaran untuk mula proses order.'}</p>${s?.transaction_id ? `<p><small>Payment ID</small><br><b>${esc(s.transaction_id)}</b></p>` : ''}${s?.id ? `<p><small>Payment Session</small><br><b>${esc(s.id)}</b></p>` : ''}${isPaid ? '' : '<button id="odPay" class="od-btn">Pay Now</button>'}</section><a class="od-btn" href="https://wa.me/60179860656?text=${encodeURIComponent('Hi iCetak, saya nak tanya order ' + o.order_no)}" target="_blank">💬 Tanya Order Ini</a></main>`;
  document.querySelector<HTMLButtonElement>('#odBack')!.onclick = () => history.back();
  document.querySelector<HTMLButtonElement>('#odPay')?.addEventListener('click', () => { location.href = `${location.pathname}?order=${o.public_token}`; });
}

let last = '', busy = false;
async function tick() {
  if (busy) return;
  const app = document.querySelector('#app');
  if (!app || !(app.textContent || '').includes('Order Detail')) return;
  const r = ref();
  if (!r || (last === r.val && document.querySelector('.od'))) return;
  busy = true;
  try { const d = await load(r); if (d) { last = r.val; render(d); } } finally { busy = false; }
}

setInterval(() => void tick(), 900);
window.addEventListener('load', () => void tick());
export {};
