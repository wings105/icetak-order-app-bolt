import { supabase } from './appdeploy-client';

type DbOrder = Record<string, any>;
type DbItem = Record<string, any>;
type DbComponent = Record<string, any>;
type DbSession = Record<string, any>;

const WA = '60179860656';
const img: Record<string, string> = {
  acrylic: 'https://cf.shopee.com.my/file/my-11134207-7qukw-ljwh8grpguaefa.jpg',
  edible: 'https://cf.shopee.com.my/file/sg-11134201-23010-92ucf0wnr...jpg',
  wafer: 'https://cf.shopee.com.my/file/my-11134207-7r992-lrwi64nt1t6fff.jpg',
  mirror: 'https://icetak.myshopify.com/cdn/shop/products/d1e36d97-b781-45d2-aa72-b66ea994ecdb_360x.jpg',
  printed: 'https://icetak.myshopify.com/cdn/shop/products/15bace3254888672b80c9d166c4792e9_d2bf378c-423b-414b-be67-6b8455feed5a_360x.jpg',
  burnaway: 'https://cf.shopee.com.my/file/my-11134207-7r98u-lrmqbo2qxw531d.jpg',
};

const money = (n: number) => `RM${Number.isInteger(n) ? n : n.toFixed(2)}`;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
const paid = (o: DbOrder) => ['paid', 'matched', 'confirmed'].includes(String(o.payment_status || '').toLowerCase()) || String(o.status || '').toLowerCase() === 'payment_received';
const kind = (v: string) => v === 'mirror' ? 'mirror' : v === 'acrylic' ? 'acrylic' : v === 'wafer' ? 'wafer' : v === 'burnaway' ? 'burnaway' : v === 'printed' ? 'printed' : 'edible';

function workflowLabel(v: string) {
  const s = String(v || '').replaceAll('_', ' ').toLowerCase();
  if (s.includes('review')) return 'Waiting Review';
  if (s.includes('design')) return 'Design Editing';
  if (s.includes('approved')) return 'Approved';
  if (s.includes('production') || s.includes('print') || s.includes('cut')) return 'Production';
  if (s.includes('finish') || s.includes('pack') || s.includes('quality')) return 'Finishing';
  if (s.includes('ready')) return 'Ready';
  if (s.includes('ship')) return 'Shipped';
  return 'Order Received';
}

function steps(review: boolean, delivery: string) {
  const last = delivery === 'pickup' ? 'Ready' : 'Shipped';
  return review
    ? ['Order Received', 'Design Editing', 'Waiting Review', 'Approved', 'Production', 'Finishing', last]
    : ['Order Received', 'Design Editing', 'Production', 'Finishing', last];
}

function stageIndex(workflow: string, review: boolean, delivery: string) {
  const list = steps(review, delivery);
  const i = list.indexOf(workflowLabel(workflow));
  return i < 0 ? 0 : i;
}

function findRef() {
  const params = new URLSearchParams(location.search);
  const token = params.get('order');
  if (token) return { value: token, col: 'public_token' };
  const text = document.querySelector('#app')?.textContent || '';
  const m = text.match(/ICT-\d{8}-[A-Z0-9]+/);
  return m ? { value: m[0], col: 'order_no' } : null;
}

async function loadOrder() {
  const ref = findRef();
  if (!ref) return null;
  const q = supabase.from('orders').select('*').limit(1);
  const { data: orders, error } = ref.col === 'public_token' ? await q.eq('public_token', ref.value) : await q.eq('order_no', ref.value);
  if (error || !orders?.[0]) return null;
  const o = orders[0];
  const [items, comps, sessions] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', o.id).order('created_at', { ascending: true }),
    supabase.from('production_components').select('*').eq('order_id', o.id).order('created_at', { ascending: true }),
    supabase.from('payment_sessions').select('*').eq('order_id', o.id).order('created_at', { ascending: false }).limit(5),
  ]);
  return { order: o, items: items.data || [], comps: comps.data || [], sessions: sessions.data || [] };
}

function timeline(c: DbComponent, delivery: string) {
  const review = Boolean(c.review_required);
  const list = steps(review, delivery);
  const cur = stageIndex(c.workflow, review, delivery);
  return `<div class="horizontal-track" style="--steps:${list.length}">${list.map((s, i) => `<div class="h-step ${i < cur ? 'done' : ''} ${i === cur ? 'current' : ''}"><i>${i <= cur ? '✓' : ''}</i><span>${s === 'Order Received' ? 'Received' : s === 'Design Editing' ? 'Design' : s === 'Waiting Review' ? 'Review' : s}</span></div>`).join('')}</div>`;
}

function render(data: { order: DbOrder; items: DbItem[]; comps: DbComponent[]; sessions: DbSession[] }) {
  const { order, items, comps, sessions } = data;
  const isPaid = paid(order);
  const matched = sessions.find(s => s.status === 'matched') || sessions[0];
  const delivery = String(order.delivery_method || 'pickup');
  const cards = items.map((item, index) => {
    const linked = comps.filter(c => String(c.order_item_id || '') === String(item.id));
    const fallback = [{ id: item.id, label: item.title, workflow: item.workflow || 'order_received', review_required: item.review_required }];
    const used = linked.length ? linked : fallback;
    return { item, comps: used, index };
  });
  const all = cards.flatMap(x => x.comps);
  const progress = Math.round((all.reduce((sum, c) => sum + stageIndex(c.workflow, Boolean(c.review_required), delivery) / Math.max(1, steps(Boolean(c.review_required), delivery).length - 1), 0) / Math.max(1, all.length)) * 100);

  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;
  app.innerHTML = `<header class="checkout-head"><button id="odBack">‹</button><h1>Order Detail</h1></header><main class="order-detail-page"><section class="order-summary-card"><div><small>Order ID</small><div class="order-id-row"><h2>${esc(order.order_no)}</h2><button id="odCopy">⧉</button></div><p>Date Need ${esc(order.date_need || '')}</p><div class="recipient-details"><b>${esc(order.delivery_name || 'Customer')}</b><span>${esc(order.delivery_phone || '')}</span><small>${delivery === 'pickup' ? '📍 Pickup — Bandar Baru Pasir Puteh' : '🚚 ' + esc([order.delivery_address, order.delivery_postcode, order.delivery_city, order.delivery_state].filter(Boolean).join(', '))}</small></div></div><span class="status-pill">${isPaid ? 'In Production' : 'Waiting Payment'}</span></section><section class="overall-progress"><div><b>Overall Progress</b><span>${progress}% • ${all.length} proses</span></div><div class="overall-bar"><i style="width:${progress}%"></i></div></section><section class="compact-track-list"><div class="section-title"><b>Item & Production Tracking</b><button id="odRefresh">↻ Refresh</button></div>${cards.map(({ item, comps, index }) => `<article class="item-production-card"><header><img src="${img[kind(item.product_type)] || img.edible}" alt="${esc(item.title)}"><div><small>Item ${index + 1}</small><b>${Number(item.qty || 1)}× ${esc(item.title || 'Item')}</b><span>${esc(item.size || '')} • ${esc(item.style || '')}</span></div><strong>${money(Number(item.price || 0) * Number(item.qty || 1))}</strong></header><div class="component-list">${comps.map(c => `<section class="component-track"><div class="component-head"><b>${esc(c.label || item.title)}</b><span>${esc(workflowLabel(c.workflow))}</span></div>${timeline(c, delivery)}${Boolean(c.review_required) && workflowLabel(c.workflow) === 'Waiting Review' ? '<div class="review-panel"><span>Design belum dimuat naik oleh staff.</span></div>' : ''}</section>`).join('')}</div></article>`).join('')}</section><section class="payment-box ${isPaid ? 'paid' : ''}"><b>Payment: ${isPaid ? 'Paid ✅' : 'Unpaid'}</b><p>${isPaid ? 'Bayaran telah diterima.' : 'Selesaikan bayaran untuk mula proses order.'}</p>${isPaid && matched?.transaction_id ? `<p><small>Payment ID</small><br><b>${esc(matched.transaction_id)}</b></p>` : ''}${isPaid && matched?.id ? `<p><small>Payment Session</small><br><b>${esc(matched.id)}</b></p>` : ''}${isPaid ? '' : '<button id="odPay" class="pay-now-btn">Pay Now</button>'}</section>${!isPaid ? '<button id="odCancel" class="customer-cancel-btn">Cancel Order</button>' : ''}<div class="order-actions"><a href="https://wa.me/${WA}?text=${encodeURIComponent('Hi iCetak, saya nak tanya tentang order ' + order.order_no)}" target="_blank">💬 Tanya Order Ini</a><button id="odRefresh2">↻ Refresh</button></div></main>`;
  document.querySelector<HTMLButtonElement>('#odBack')!.onclick = () => history.back();
  document.querySelector<HTMLButtonElement>('#odCopy')!.onclick = async () => navigator.clipboard.writeText(`Order ID: ${order.order_no}\n${location.href}`);
  document.querySelector<HTMLButtonElement>('#odRefresh')!.onclick = () => location.reload();
  document.querySelector<HTMLButtonElement>('#odRefresh2')!.onclick = () => location.reload();
}

async function enhance() {
  const app = document.querySelector('#app');
  if (!app) return;
  const text = app.textContent || '';
  if (!text.includes('Order Detail')) return;
  if ((app as HTMLElement).dataset.orderDetailEnhanced === '1') return;
  const data = await loadOrder();
  if (!data) return;
  (app as HTMLElement).dataset.orderDetailEnhanced = '1';
  render(data);
}

if (typeof window !== 'undefined') {
  const mo = new MutationObserver(() => enhance().catch(() => undefined));
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => enhance().catch(() => undefined));
  window.addEventListener('popstate', () => setTimeout(() => enhance().catch(() => undefined), 120));
}
