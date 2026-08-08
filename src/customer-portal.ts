import { api } from './appdeploy-client';
import './customer-portal.css';

type HistoryTab = 'to_pay' | 'progress' | 'receive' | 'completed';
type Component = {
  id: string;
  type: string;
  label: string;
  workflow: string;
  reviewRequired: boolean;
  reviewStatus: string;
  previewUrl?: string;
  legacy?: boolean;
};
type OrderItem = {
  id: string;
  k: string;
  title: string;
  qty: number;
  size: string;
  style: string;
  customText?: string;
  price: number;
  workflow: string;
  reviewRequired: boolean;
  previewUrl?: string;
  components: Component[];
};
type ShipmentEvent = {
  status: string;
  statusGroup: string;
  previousStatus: string;
  event: string;
  eventTime: number;
};
type Shipment = {
  tracking: string;
  courier: string;
  trackingLink: string;
  connoteUrl: string;
  status: string;
  statusGroup: string;
  updatedAt: number;
  events: ShipmentEvent[];
};
type Order = {
  id: string;
  orderToken: string;
  tab: HistoryTab;
  dateNeed: string;
  dateNeedRaw?: string;
  created: string;
  total: number;
  payment: string;
  paymentStatus?: string;
  delivery: string;
  deliverySummary?: string;
  deliveryName?: string;
  deliveryPhone?: string;
  status: string;
  actionCount: number;
  tracking?: string;
  shipment?: Shipment;
  canCancel?: boolean;
  customerConfirmed?: boolean;
  items: OrderItem[];
};
type Payment = {
  id: string;
  orderToken: string;
  orderId: string;
  baseAmount: number;
  expectedAmount: number;
  discount: number;
  expiresAt: number;
  status: string;
  transactionId: string;
  receiptName: string;
  receiptUrl: string;
  submittedAt: number;
  matchedAt: number;
};

type ApiResponse<T> = { data: T; status: number };

const WA = '60179860656';
const QR_URL = 'https://t3747262.p.clickup-attachments.com/t3747262/836016e0-e613-447b-b61a-291fddd3f83d_large.png';
const PRODUCT_IMAGES: Record<string, string> = {
  acrylic: 'https://cf.shopee.com.my/file/my-11134207-7qukw-ljwh8grpguaefa.jpg',
  edible: 'https://cf.shopee.com.my/file/sg-11134201-23010-92ucf0wnrrlv85.jpg',
  burnaway: 'https://cf.shopee.com.my/file/my-11134207-7r98u-lrmqbo2qxw531d.jpg',
  wafer: 'https://cf.shopee.com.my/file/my-11134207-7r992-lrwi64nt1t6fff.jpg',
  mirror: 'https://icetak.myshopify.com/cdn/shop/products/d1e36d97-b781-45d2-aa72-b66ea994ecdb_360x.jpg',
  printed: 'https://icetak.myshopify.com/cdn/shop/products/15bace3254888672b80c9d166c4792e9_d2bf378c-423b-414b-be67-6b8455feed5a_360x.jpg',
};

let activeHistoryTab: HistoryTab = 'progress';
let historyRequest = 0;
let orderRequest = 0;
let paymentPoll = 0;
let observerBusy = false;

function money(value: number) {
  const amount = Number(value || 0);
  return `RM${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function imageFor(kind: string) {
  return PRODUCT_IMAGES[String(kind || '').toLowerCase()] || PRODUCT_IMAGES.printed;
}

function customerToken() {
  return new URL(location.href).searchParams.get('c') || localStorage.getItem('customer_token') || '';
}

function selectedOrderToken() {
  const queryToken = new URL(location.href).searchParams.get('order');
  const stateToken = (history.state as { orderToken?: string } | null)?.orderToken;
  return queryToken || stateToken || '';
}

function orderUrl(token: string) {
  const url = new URL(location.href);
  ['c', 'login', 'magic_token', 'confirm', 'token'].forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('order', token);
  return url.toString();
}

function orderQuestionUrl(order: Order) {
  const items = order.items
    .map((item, index) => `${index + 1}. ${item.qty}x ${item.title}${item.size ? ` (${item.size})` : ''}`)
    .join('\n');
  const message = `Hi iCetak, saya nak tanya tentang order ini.\n\nOrder ID: ${order.id}\nDate Need: ${order.dateNeed}\nStatus: ${order.status}\nPayment: ${order.payment}\nDelivery: ${order.delivery}\n\nItem:\n${items}\n\nPertanyaan saya:`;
  return `https://wa.me/${WA}?text=${encodeURIComponent(message)}`;
}

function toast(message: string, bad = false) {
  const existing = document.querySelector('.cp-toast');
  existing?.remove();
  const element = document.createElement('div');
  element.className = `cp-toast${bad ? ' bad' : ''}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 2600);
}

function modal(content: string) {
  document.querySelector('.cp-modal-wrap')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'cp-modal-wrap';
  wrap.innerHTML = `<section class="cp-modal">${content}</section>`;
  document.body.append(wrap);
  wrap.addEventListener('click', (event) => {
    if (event.target === wrap || (event.target as HTMLElement).closest('[data-cp-close]')) wrap.remove();
  });
  return wrap;
}

async function edgeGet<T>(path: string): Promise<ApiResponse<T>> {
  return api.get(path) as Promise<ApiResponse<T>>;
}

async function edgePost<T>(path: string, body: unknown = {}): Promise<ApiResponse<T>> {
  if (path.includes('/payment-receipt')) {
    const env = (import.meta as any).env || {};
    const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
    const response = await fetch(`${supabaseUrl}/functions/v1/api${path.replace(/^\/api/, '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return { data, status: response.status } as ApiResponse<T>;
  }
  return api.post(path, body) as Promise<ApiResponse<T>>;
}

function statusTone(status: string) {
  const value = status.toLowerCase();
  if (value.includes('action') || value.includes('waiting payment')) return 'alert';
  if (value.includes('cancel') || value.includes('issue')) return 'danger';
  if (value.includes('complete') || value.includes('ready') || value.includes('paid')) return 'success';
  return '';
}

function historyHeader() {
  return `<section class="cp-history-hero">
    <h2>Track Your Order</h2>
    <p>Semak bayaran, progress design, production dan penghantaran.</p>
    <small>Live order history</small>
  </section>`;
}

function renderHistoryLoading(main: HTMLElement) {
  main.dataset.fullPortal = '1';
  main.classList.add('cp-page');
  main.innerHTML = `${historyHeader()}<section class="cp-loading-card"><span class="cp-spinner"></span><b>Loading orders…</b></section>`;
}

function renderHistory(main: HTMLElement, orders: Order[]) {
  const tabs: Array<[HistoryTab, string, string]> = [
    ['to_pay', '💳', 'To Pay'],
    ['progress', '🛍️', 'In Progress'],
    ['receive', '📦', 'To Receive'],
    ['completed', '✅', 'Completed'],
  ];
  const shown = orders.filter((order) => order.tab === activeHistoryTab);
  main.dataset.fullPortal = '1';
  main.classList.add('cp-page');
  main.innerHTML = `${historyHeader()}
    <nav class="cp-history-tabs">
      ${tabs.map(([tab, icon, label]) => `<button data-cp-tab="${tab}" class="${activeHistoryTab === tab ? 'active' : ''}">
        <span class="cp-tab-icon">${icon}</span><small>${label}</small><b>${orders.filter((order) => order.tab === tab).length}</b>
      </button>`).join('')}
    </nav>
    <section class="cp-history-list">
      ${shown.length ? shown.map((order) => {
        const previewItems = order.items.slice(0, 3);
        const itemTotal = order.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
        return `<article class="cp-order-card" data-cp-order="${escapeHtml(order.orderToken)}">
          <header>
            <div><b>${escapeHtml(order.id)}</b><small>Order ${escapeHtml(order.created)}</small></div>
            <span class="cp-status ${statusTone(order.status)}">${escapeHtml(order.status)}</span>
          </header>
          <div class="cp-order-preview">
            <div class="cp-preview-images">${previewItems.map((item) => `<img src="${imageFor(item.k)}" alt="${escapeHtml(item.title)}">`).join('')}</div>
            <div class="cp-preview-copy">
              <b>${escapeHtml(order.items[0]?.title || 'Order')}${order.items.length > 1 ? ` +${order.items.length - 1} item` : ''}</b>
              <span>${itemTotal} item • Date Need ${escapeHtml(order.dateNeed)}</span>
              <small>${order.delivery === 'Pickup' ? '📍' : '🚚'} ${escapeHtml(order.deliverySummary || order.delivery)}</small>
              <strong>${money(order.total)}</strong>
            </div>
          </div>
          ${order.actionCount ? `<div class="cp-action-banner">⚠️ ${order.actionCount} design perlukan tindakan anda</div>` : ''}
          <footer>
            <span>${escapeHtml(order.payment)} • ${escapeHtml(order.delivery)}</span>
            <div><a data-cp-ask href="${orderQuestionUrl(order)}" target="_blank" rel="noopener">Tanya</a><button data-cp-view>View Order ›</button></div>
          </footer>
        </article>`;
      }).join('') : `<section class="cp-empty"><b>Tiada order</b><p>Order dalam kategori ini akan muncul di sini.</p></section>`}
    </section>`;

  main.querySelectorAll<HTMLButtonElement>('[data-cp-tab]').forEach((button) => {
    button.onclick = () => {
      activeHistoryTab = button.dataset.cpTab as HistoryTab;
      renderHistory(main, orders);
    };
  });
  main.querySelectorAll<HTMLElement>('[data-cp-ask]').forEach((element) => {
    element.onclick = (event) => event.stopPropagation();
  });
  main.querySelectorAll<HTMLElement>('[data-cp-order]').forEach((card) => {
    card.onclick = (event) => {
      if ((event.target as HTMLElement).closest('[data-cp-ask]')) return;
      const token = card.dataset.cpOrder || '';
      if (!token) return;
      const url = new URL(location.href);
      url.searchParams.delete('c');
      url.searchParams.set('order', token);
      history.pushState({ page: 'order', orderToken: token }, '', url);
      renderOrderShell(token);
    };
  });
}

async function loadFullHistory(main: HTMLElement) {
  const token = customerToken();
  if (!token) return;
  const request = ++historyRequest;
  renderHistoryLoading(main);
  try {
    const response = await edgeGet<{ orders: Order[] }>(`/api/customers/${encodeURIComponent(token)}/orders`);
    if (request !== historyRequest || !document.body.contains(main)) return;
    const orders = response.data.orders || [];
    if (!orders.some((order) => order.tab === activeHistoryTab)) {
      activeHistoryTab = orders.some((order) => order.tab === 'progress') ? 'progress' : orders[0]?.tab || 'progress';
    }
    renderHistory(main, orders);
  } catch (error) {
    if (request !== historyRequest) return;
    main.innerHTML = `${historyHeader()}<section class="cp-empty"><b>History gagal dimuatkan</b><p>${escapeHtml(error instanceof Error ? error.message : 'Cuba refresh semula.')}</p><button data-cp-retry-history>Refresh</button></section>`;
    main.querySelector<HTMLButtonElement>('[data-cp-retry-history]')!.onclick = () => void loadFullHistory(main);
  }
}

function componentSteps(component: Component, delivery: string) {
  const finalLabel = delivery === 'Pickup' ? 'Ready' : 'Shipped';
  return component.reviewRequired
    ? ['Order Received', 'Design Editing', 'Waiting Review', 'Approved', 'Production', 'Finishing', finalLabel]
    : ['Order Received', 'Design Editing', 'Production', 'Finishing', finalLabel];
}

function componentIndex(component: Component, delivery: string) {
  const steps = componentSteps(component, delivery);
  let workflow = component.workflow;
  if (workflow === 'Ready to Pickup' || workflow === 'Ready for Pickup') workflow = 'Ready';
  if (workflow === 'Delivered') return steps.length - 1;
  const index = steps.indexOf(workflow);
  return index < 0 ? 0 : index;
}

function stepLabel(step: string) {
  if (step === 'Order Received') return 'Received';
  if (step === 'Design Editing') return 'Design';
  if (step === 'Waiting Review') return 'Review';
  return step;
}

function renderShipment(order: Order) {
  const shipment = order.shipment;
  if (order.delivery === 'Pickup') {
    const ready = order.status.toLowerCase().includes('ready');
    return `<section class="cp-section cp-pickup-card ${ready ? 'ready' : ''}">
      <header><div><small>Pickup</small><h3>${ready ? 'Order Ready for Pickup' : 'Pickup di Kedai'}</h3></div><span>${ready ? '✅' : '📍'}</span></header>
      <p>Bandar Baru Pasir Puteh</p>
      <small>${ready ? 'Bawa Order ID semasa pickup.' : 'Status akan berubah kepada Ready for Pickup selepas packing selesai.'}</small>
    </section>`;
  }
  if (!shipment?.tracking) {
    return `<section class="cp-section cp-shipment-card"><header><div><small>${escapeHtml(order.delivery)}</small><h3>Tracking belum tersedia</h3></div><span>🚚</span></header><p>AWB dan tracking akan muncul secara automatik selepas parcel disediakan.</p></section>`;
  }
  return `<section class="cp-section cp-shipment-card">
    <header class="cp-shipment-head">
      <div><small>${escapeHtml(shipment.courier || order.delivery)}</small><h3>${escapeHtml(shipment.status || 'Shipment Data Received')}</h3>${shipment.statusGroup ? `<span>${escapeHtml(shipment.statusGroup)}</span>` : ''}</div>
      ${shipment.trackingLink ? `<a href="${escapeHtml(shipment.trackingLink)}" target="_blank" rel="noopener">Track Parcel</a>` : ''}
    </header>
    <button class="cp-tracking-copy" data-cp-copy-tracking="${escapeHtml(shipment.tracking)}"><span>${escapeHtml(shipment.tracking)}</span><b>Copy</b></button>
    ${shipment.events?.length ? `<div class="cp-shipment-timeline">${shipment.events.map((event, index) => `<article class="${index === 0 ? 'latest' : ''}"><i></i><div><b>${escapeHtml(event.status)}</b>${event.statusGroup ? `<span>${escapeHtml(event.statusGroup)}</span>` : ''}<small>${event.eventTime ? new Date(event.eventTime).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' }) : ''}</small></div></article>`).join('')}</div>` : ''}
  </section>`;
}

function renderOrder(main: HTMLElement, order: Order) {
  const components = order.items.flatMap((item) => item.components || []);
  const progresses = components.map((component) => componentIndex(component, order.delivery) / Math.max(1, componentSteps(component, order.delivery).length - 1));
  const overall = Math.round((progresses.reduce((sum, progress) => sum + progress, 0) / Math.max(1, progresses.length)) * 100);
  const waitingReview = components.filter((component) => component.reviewRequired && component.workflow === 'Waiting Review').length;
  main.dataset.fullPortal = '1';
  main.classList.add('cp-page');
  main.innerHTML = `<section class="cp-section cp-summary">
      <div>
        <small>Order ID</small>
        <div class="cp-order-id"><h2>${escapeHtml(order.id)}</h2><button data-cp-copy-order>⧉</button></div>
        <p>Date Need ${escapeHtml(order.dateNeed)}</p>
        <div class="cp-recipient"><b>${escapeHtml(order.deliveryName || 'Customer')}</b><span>${escapeHtml(order.deliveryPhone || '')}</span><small>${order.delivery === 'Pickup' ? '📍' : '🚚'} ${escapeHtml(order.deliverySummary || order.delivery)}</small></div>
      </div>
      <span class="cp-status ${statusTone(order.status)}">${escapeHtml(order.status)}</span>
    </section>
    <section class="cp-section cp-overall">
      <div><b>Overall Progress</b><span>${overall}% • ${components.length} proses</span></div>
      <div class="cp-overall-bar"><i style="width:${overall}%"></i></div>
      ${waitingReview ? `<p>⚠️ ${waitingReview} design perlukan semakan dan approval anda.</p>` : ''}
    </section>
    <section class="cp-section cp-production">
      <header class="cp-section-head"><b>Item & Production Tracking</b><button data-cp-refresh-order>↻ Refresh</button></header>
      ${order.items.map((item, itemIndex) => `<article class="cp-item-card">
        <header><img src="${imageFor(item.k)}" alt="${escapeHtml(item.title)}"><div><small>Item ${itemIndex + 1}</small><b>${item.qty}× ${escapeHtml(item.title)}</b><span>${escapeHtml([item.size, item.style].filter(Boolean).join(' • '))}</span></div><strong>${money(item.price * item.qty)}</strong></header>
        ${item.customText ? `<p class="cp-custom-text">${escapeHtml(item.customText)}</p>` : ''}
        <div class="cp-component-list">${(item.components || []).map((component) => {
          const steps = componentSteps(component, order.delivery);
          const current = componentIndex(component, order.delivery);
          const needsReview = component.reviewRequired && component.workflow === 'Waiting Review';
          return `<section class="cp-component">
            <div class="cp-component-head"><b>${escapeHtml(component.label)}</b><span>${escapeHtml(component.workflow)}</span></div>
            <div class="cp-track" style="--cp-steps:${steps.length}">${steps.map((step, index) => `<div class="cp-step ${index < current ? 'done' : ''} ${index === current ? 'current' : ''}"><i>${index <= current ? '✓' : ''}</i><span>${escapeHtml(stepLabel(step))}</span></div>`).join('')}</div>
            ${needsReview ? `<div class="cp-review-panel">${component.previewUrl ? `<a href="${escapeHtml(component.previewUrl)}" target="_blank" rel="noopener">View Design</a><button data-cp-request-edit="${escapeHtml(component.id)}" data-cp-legacy="${component.legacy ? '1' : '0'}">Request Edit</button><button class="approve" data-cp-approve="${escapeHtml(component.id)}" data-cp-legacy="${component.legacy ? '1' : '0'}">Approve</button>` : '<span>Design belum dimuat naik oleh staff.</span>'}</div>` : ''}
          </section>`;
        }).join('')}</div>
      </article>`).join('')}
    </section>
    <section class="cp-section cp-payment ${order.payment === 'Paid' ? 'paid' : ''}">
      <b>Payment: ${escapeHtml(order.payment)}${order.payment === 'Paid' ? ' ✅' : ''}</b>
      <p>${order.payment === 'Paid' ? 'Bayaran telah diterima.' : order.payment === 'Cash at Counter' ? 'Bayar semasa pickup di kaunter.' : order.paymentStatus === 'pending_review' ? 'Bukti bayaran sedang disemak oleh admin.' : 'Selesaikan bayaran untuk mula proses order.'}</p>
      ${order.payment === 'Unpaid' ? `<button data-cp-pay-now>${order.paymentStatus === 'pending_review' ? 'View Payment Status' : 'Pay Now'}</button>` : ''}
    </section>
    ${renderShipment(order)}
    ${order.canCancel ? '<button class="cp-cancel-order" data-cp-cancel>Cancel Order</button>' : ''}
    <div class="cp-order-actions"><a href="${orderQuestionUrl(order)}" target="_blank" rel="noopener">💬 Tanya Order Ini</a><button data-cp-refresh-bottom>↻ Refresh</button></div>`;

  const refresh = () => void loadFullOrder(main, order.orderToken);
  main.querySelectorAll<HTMLButtonElement>('[data-cp-refresh-order],[data-cp-refresh-bottom]').forEach((button) => button.onclick = refresh);
  main.querySelector<HTMLButtonElement>('[data-cp-copy-order]')!.onclick = async () => {
    await navigator.clipboard.writeText(`Order ID: ${order.id}\n${orderUrl(order.orderToken)}`);
    toast('Order ID & link copied');
  };
  main.querySelector<HTMLButtonElement>('[data-cp-copy-tracking]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(button.dataset.cpCopyTracking || '');
    toast('Tracking copied');
  });
  main.querySelector<HTMLButtonElement>('[data-cp-pay-now]')?.addEventListener('click', () => void openPayment(order, main));
  main.querySelector<HTMLButtonElement>('[data-cp-cancel]')?.addEventListener('click', () => void confirmCancel(order, main));
  main.querySelectorAll<HTMLButtonElement>('[data-cp-approve]').forEach((button) => {
    button.onclick = () => void reviewAction(order, main, button, false);
  });
  main.querySelectorAll<HTMLButtonElement>('[data-cp-request-edit]').forEach((button) => {
    button.onclick = () => void reviewAction(order, main, button, true);
  });
}

function renderOrderLoading(main: HTMLElement) {
  main.dataset.fullPortal = '1';
  main.classList.add('cp-page');
  main.innerHTML = `<section class="cp-loading-card"><span class="cp-spinner"></span><b>Loading order…</b></section>`;
}

async function loadFullOrder(main: HTMLElement, token: string) {
  if (!token) return;
  const request = ++orderRequest;
  renderOrderLoading(main);
  try {
    const [orderResponse, shipmentResponse] = await Promise.all([
      edgeGet<{ order: Order }>(`/api/orders/${encodeURIComponent(token)}`),
      edgeGet<{ shipment: Shipment }>(`/api/orders/${encodeURIComponent(token)}/shipment`),
    ]);
    if (request !== orderRequest || !document.body.contains(main)) return;
    renderOrder(main, { ...orderResponse.data.order, shipment: shipmentResponse.data.shipment });
  } catch (error) {
    if (request !== orderRequest) return;
    main.innerHTML = `<section class="cp-empty"><b>Order tidak ditemui</b><p>${escapeHtml(error instanceof Error ? error.message : 'Cuba refresh semula.')}</p><button data-cp-retry-order>Refresh</button></section>`;
    main.querySelector<HTMLButtonElement>('[data-cp-retry-order]')!.onclick = () => void loadFullOrder(main, token);
  }
}

function renderOrderShell(token: string) {
  let main = document.querySelector<HTMLElement>('main.order-detail-page');
  if (!main) {
    const app = document.querySelector<HTMLElement>('#app');
    if (!app) return;
    app.innerHTML = `<header class="checkout-head"><button id="back">‹</button><h1>Order Detail</h1></header><main class="order-detail-page cp-page"></main>`;
    app.querySelector<HTMLButtonElement>('#back')!.onclick = () => history.back();
    main = app.querySelector<HTMLElement>('main.order-detail-page');
  }
  if (main) void loadFullOrder(main, token);
}

async function reviewAction(order: Order, main: HTMLElement, button: HTMLButtonElement, requestEdit: boolean) {
  const componentId = requestEdit ? button.dataset.cpRequestEdit : button.dataset.cpApprove;
  if (!componentId) return;
  let comment = '';
  if (requestEdit) {
    const value = window.prompt('Nyatakan perubahan yang diperlukan:');
    if (value === null) return;
    comment = value.trim();
    if (!comment) {
      toast('Masukkan arahan perubahan', true);
      return;
    }
  }
  const original = button.textContent || '';
  button.disabled = true;
  button.textContent = requestEdit ? 'Sending…' : 'Approving…';
  const legacy = button.dataset.cpLegacy === '1';
  const path = legacy ? 'items' : 'components';
  try {
    await edgePost(`/api/orders/${encodeURIComponent(order.orderToken)}/${path}/${encodeURIComponent(componentId)}/${requestEdit ? 'request-edit' : 'approve'}`, { comment });
    toast(requestEdit ? 'Edit request dihantar' : 'Design approved');
    await loadFullOrder(main, order.orderToken);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Tindakan gagal', true);
    button.disabled = false;
    button.textContent = original;
  }
}

async function confirmCancel(order: Order, main: HTMLElement) {
  const wrap = modal(`<button data-cp-close class="cp-modal-x">×</button><h2>Cancel Order?</h2><p>Order belum dibayar dan belum masuk production.</p><button data-cp-confirm-cancel class="cp-danger-btn">Ya, Cancel Order</button><button data-cp-close class="cp-secondary-btn">Kekalkan Order</button>`);
  wrap.querySelector<HTMLButtonElement>('[data-cp-confirm-cancel]')!.onclick = async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Cancelling…';
    try {
      await edgePost(`/api/orders/${encodeURIComponent(order.orderToken)}/cancel`, {});
      wrap.remove();
      toast('Order cancelled');
      await loadFullOrder(main, order.orderToken);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Ya, Cancel Order';
      toast(error instanceof Error ? error.message : 'Order tidak boleh dibatalkan', true);
    }
  };
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function clearPaymentPoll() {
  if (paymentPoll) window.clearInterval(paymentPoll);
  paymentPoll = 0;
}

async function fetchPayment(orderToken: string, forceNew = false) {
  const response = await edgePost<{ payment: Payment }>(`/api/orders/${encodeURIComponent(orderToken)}/payment-session`, { force_new: forceNew });
  return response.data.payment;
}

function paymentContent(payment: Payment) {
  if (payment.status === 'matched') {
    return `<button data-cp-close class="cp-modal-x">×</button><div class="cp-payment-success">✓</div><h2>Payment Received</h2><strong class="cp-paid-amount">${money(payment.expectedAmount)}</strong><p>Bayaran telah dipadankan. Order akan masuk ke proses seterusnya.</p><button data-cp-payment-done class="cp-primary-btn">View Order Status</button>`;
  }
  const remaining = Math.max(0, payment.expiresAt - Date.now());
  const expired = remaining <= 0;
  const minutes = String(Math.floor(remaining / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
  return `<button data-cp-close class="cp-modal-x">×</button>
    <small>Order ${escapeHtml(payment.orderId)}</small><h2>Scan DuitNow QR</h2>
    <div class="cp-countdown ${expired ? 'expired' : ''}"><span>${expired ? 'Session expired' : 'Amount reserved for'}</span><b data-cp-countdown>${minutes}:${seconds}</b></div>
    <img class="cp-payment-qr" src="${QR_URL}" alt="DuitNow QR">
    <div class="cp-qr-actions"><a href="${QR_URL}" target="_blank" download="icetak-duitnow-qr.png">Save QR</a><button data-cp-copy-amount>Copy Amount</button></div>
    <button class="cp-exact-amount" data-cp-copy-amount><small>Exact Amount</small><strong>${money(payment.expectedAmount)}</strong><span>Tap to copy</span></button>
    ${payment.discount > 0 ? `<div class="cp-discount">Discount matching amount: ${money(payment.discount)}</div>` : ''}
    <p class="cp-payment-note">Masukkan jumlah tepat. Jangan round up atau ubah sen.</p>
    ${expired ? '<button data-cp-new-payment class="cp-primary-btn">Generate New 10-Minute Amount</button>' : ''}
    <hr><h3>Bukti Bayaran</h3>
    ${payment.status === 'receipt_submitted' || payment.status === 'pending_review' || payment.receiptName ? `<div class="cp-receipt-pending"><b>⏳ Pending Admin Approval</b><span>${escapeHtml(payment.receiptName || 'Bukti bayaran telah diterima.')}</span>${payment.receiptUrl ? `<a href="${escapeHtml(payment.receiptUrl)}" target="_blank" rel="noopener">View uploaded receipt</a>` : ''}</div>` : `<label class="cp-receipt-upload">Choose Receipt<input data-cp-receipt type="file" accept="image/jpeg,image/png,application/pdf"></label><button data-cp-upload-receipt class="cp-primary-btn">Upload Payment Receipt</button>`}`;
}

async function openPayment(order: Order, main: HTMLElement) {
  clearPaymentPoll();
  const wrap = modal(`<button data-cp-close class="cp-modal-x">×</button><div class="cp-loading-card"><span class="cp-spinner"></span><b>Preparing payment…</b></div>`);
  let payment: Payment;
  try {
    payment = await fetchPayment(order.orderToken);
  } catch (error) {
    wrap.querySelector('.cp-modal')!.innerHTML = `<button data-cp-close class="cp-modal-x">×</button><h2>Payment unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : 'Cuba semula.')}</p>`;
    return;
  }

  const paint = () => {
    const panel = wrap.querySelector<HTMLElement>('.cp-modal');
    if (!panel) return;
    panel.innerHTML = paymentContent(payment);
    panel.querySelectorAll<HTMLButtonElement>('[data-cp-copy-amount]').forEach((button) => {
      button.onclick = async () => {
        await navigator.clipboard.writeText(payment.expectedAmount.toFixed(2));
        toast('Amount copied');
      };
    });
    panel.querySelector<HTMLButtonElement>('[data-cp-new-payment]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'Generating…';
      try {
        payment = await fetchPayment(order.orderToken, true);
        paint();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Gagal jana amount', true);
      }
    });
    panel.querySelector<HTMLButtonElement>('[data-cp-upload-receipt]')?.addEventListener('click', async (event) => {
      const input = panel.querySelector<HTMLInputElement>('[data-cp-receipt]')!;
      const file = input.files?.[0];
      if (!file) {
        toast('Pilih receipt dahulu', true);
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast('Receipt maksimum 5MB', true);
        return;
      }
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'Uploading…';
      try {
        const data = await fileBase64(file);
        const response = await edgePost<{ payment: Payment }>(`/api/orders/${encodeURIComponent(order.orderToken)}/payment-receipt`, { data, mime_type: file.type, file_name: file.name });
        payment = response.data.payment;
        toast('Receipt uploaded');
        paint();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Upload Payment Receipt';
        toast(error instanceof Error ? error.message : 'Upload receipt gagal', true);
      }
    });
    panel.querySelector<HTMLButtonElement>('[data-cp-payment-done]')?.addEventListener('click', async () => {
      clearPaymentPoll();
      wrap.remove();
      await loadFullOrder(main, order.orderToken);
    });
  };

  paint();
  paymentPoll = window.setInterval(async () => {
    if (!document.body.contains(wrap)) {
      clearPaymentPoll();
      return;
    }
    try {
      const next = await fetchPayment(order.orderToken);
      const changed = next.status !== payment.status || next.transactionId !== payment.transactionId || next.receiptName !== payment.receiptName;
      payment = next;
      if (changed) paint();
      const countdown = wrap.querySelector<HTMLElement>('[data-cp-countdown]');
      if (countdown && payment.status !== 'matched') {
        const left = Math.max(0, payment.expiresAt - Date.now());
        countdown.textContent = `${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
      }
    } catch {
      // Keep the current payment screen; the next poll can recover.
    }
  }, 5000);
}

function enhanceCurrentView() {
  if (observerBusy) return;
  observerBusy = true;
  queueMicrotask(() => {
    observerBusy = false;
    const historyMain = document.querySelector<HTMLElement>('main.history-page');
    if (historyMain && historyMain.dataset.fullPortal !== '1' && customerToken()) {
      void loadFullHistory(historyMain);
      return;
    }
    const orderMain = document.querySelector<HTMLElement>('main.order-detail-page');
    const token = selectedOrderToken();
    if (orderMain && orderMain.dataset.fullPortal !== '1' && token) void loadFullOrder(orderMain, token);
  });
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement)?.closest<HTMLElement>('[data-order]');
  if (!target || target.closest('[data-cp-order]')) return;
  const token = target.dataset.order;
  if (!token) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const url = new URL(location.href);
  url.searchParams.delete('c');
  url.searchParams.set('order', token);
  history.pushState({ page: 'order', orderToken: token }, '', url);
  renderOrderShell(token);
}, true);

window.addEventListener('popstate', () => {
  clearPaymentPoll();
  setTimeout(enhanceCurrentView, 0);
});

const observer = new MutationObserver(enhanceCurrentView);
observer.observe(document.documentElement, { childList: true, subtree: true });
enhanceCurrentView();
