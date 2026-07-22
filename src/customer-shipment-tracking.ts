import './customer-shipment-tracking.css';

type PodFile = {
  id: string;
  position: number;
  contentType: string;
  sizeBytes: number;
  archivedAt?: string;
  url: string;
};

type ShipmentEvent = {
  id?: string;
  status: string;
  statusGroup: string;
  normalizedStatus?: string;
  statusLabel?: string;
  event: string;
  eventTime: number;
  location?: string;
  description?: string;
};

type Shipment = {
  id: string;
  reference?: string;
  tracking: string;
  courier: string;
  trackingLink: string;
  connoteUrl: string;
  thermalConnoteUrl?: string;
  status: string;
  statusGroup: string;
  normalizedStatus?: string;
  statusLabel?: string;
  updatedAt: number;
  podStatus?: string;
  podCount?: number;
  pods?: PodFile[];
  events: ShipmentEvent[];
};

type ShipmentResponse = { orderToken: string; shipment: Shipment | null };
type ShipmentHistoryResponse = { shipments: ShipmentResponse[] };

const PROJECT_URL = 'https://buivecgahhmrhlmfujgt.supabase.co';
const orderCache = new Map<string, { at: number; shipment: Shipment | null }>();
let historyCache: { token: string; at: number; shipments: Map<string, Shipment | null> } | null = null;
let enhanceTimer = 0;
let enhancing = false;

function supabaseUrl() {
  const env = (import.meta as any).env || {};
  return String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || PROJECT_URL).replace(/\/$/, '');
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeUrl(value: unknown) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function key(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function statusLabel(value: unknown) {
  const normalized = key(value);
  if (['awb_created', 'shipment_created', 'booked'].includes(normalized)) return 'AWB Created';
  if (normalized === 'picked_up') return 'Picked Up';
  if (normalized === 'in_transit') return 'In Transit';
  if (normalized === 'out_for_delivery') return 'Out for Delivery';
  if (normalized === 'delivered') return 'Delivered';
  if (normalized === 'delivery_exception') return 'Delivery Exception';
  if (normalized === 'returning') return 'Returning';
  if (normalized === 'cancelled') return 'Cancelled';
  return String(value || 'Shipment Update').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function currentState(shipment: Shipment) {
  const normalized = key(shipment.normalizedStatus || shipment.statusGroup || shipment.status);
  return {
    normalized,
    label: shipment.statusLabel || statusLabel(normalized),
    tab: normalized === 'delivered' ? 'completed' : 'receive',
  };
}

function currentCustomerToken() {
  return new URL(location.href).searchParams.get('c') || localStorage.getItem('customer_token') || '';
}

function currentOrderToken() {
  const query = new URL(location.href).searchParams.get('order');
  const state = (history.state as { orderToken?: string } | null)?.orderToken;
  return query || state || '';
}

async function request<T>(query: URLSearchParams): Promise<T> {
  const response = await fetch(`${supabaseUrl()}/functions/v1/customer-shipment?${query}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Shipment request failed (${response.status})`);
  return data as T;
}

async function shipmentForOrder(orderToken: string, force = false) {
  const cached = orderCache.get(orderToken);
  if (!force && cached && Date.now() - cached.at < 15_000) return cached.shipment;
  const data = await request<ShipmentResponse>(new URLSearchParams({ order_token: orderToken }));
  orderCache.set(orderToken, { at: Date.now(), shipment: data.shipment || null });
  return data.shipment || null;
}

async function shipmentsForCustomer(customerToken: string, force = false) {
  if (!force && historyCache?.token === customerToken && Date.now() - historyCache.at < 15_000) {
    return historyCache.shipments;
  }
  const data = await request<ShipmentHistoryResponse>(new URLSearchParams({ customer_token: customerToken }));
  const shipments = new Map<string, Shipment | null>();
  for (const item of data.shipments || []) shipments.set(item.orderToken, item.shipment || null);
  historyCache = { token: customerToken, at: Date.now(), shipments };
  return shipments;
}

function eventTime(value: number) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderPod(pod: PodFile, index: number) {
  const url = safeUrl(pod.url);
  if (!url) return '';
  const image = String(pod.contentType || '').startsWith('image/');
  return `<a class="cp-pod-item" href="${escapeHtml(url)}" target="_blank" rel="noopener">
    ${image ? `<img src="${escapeHtml(url)}" alt="Proof of Delivery ${index + 1}" loading="lazy">` : '<span>📄</span>'}
    <b>POD ${index + 1}</b>
  </a>`;
}

function renderShipmentCard(card: HTMLElement, shipment: Shipment) {
  const state = currentState(shipment);
  const signature = [shipment.id, shipment.updatedAt, shipment.podCount, shipment.events?.length].join(':');
  if (card.dataset.shipmentSignature === signature) return;
  card.dataset.shipmentSignature = signature;

  const trackingLink = safeUrl(shipment.trackingLink);
  const awbLink = safeUrl(shipment.connoteUrl);
  const pods = shipment.pods || [];
  card.classList.add('cp-shipment-enhanced');
  card.innerHTML = `<header class="cp-shipment-head">
      <div>
        <small>${escapeHtml(shipment.courier || 'Courier')}</small>
        <h3>${escapeHtml(state.label)}</h3>
        <span>${escapeHtml(shipment.status || state.label)}</span>
      </div>
      <div class="cp-shipment-links">
        ${trackingLink ? `<a href="${escapeHtml(trackingLink)}" target="_blank" rel="noopener">Track Parcel</a>` : ''}
        ${awbLink ? `<a href="${escapeHtml(awbLink)}" target="_blank" rel="noopener">View AWB</a>` : ''}
      </div>
    </header>
    ${shipment.tracking ? `<button class="cp-tracking-copy" data-cpst-copy="${escapeHtml(shipment.tracking)}"><span>${escapeHtml(shipment.tracking)}</span><b>Copy</b></button>` : ''}
    ${shipment.events?.length ? `<div class="cp-shipment-timeline">${shipment.events.map((event, index) => {
      const normalized = event.normalizedStatus || event.statusGroup || event.status;
      const label = event.statusLabel || statusLabel(normalized);
      return `<article class="${index === 0 ? 'latest' : ''}"><i></i><div>
        <b>${escapeHtml(label)}</b>
        ${event.status && key(event.status) !== key(label) ? `<span>${escapeHtml(event.status)}</span>` : ''}
        ${event.location ? `<span>📍 ${escapeHtml(event.location)}</span>` : ''}
        <small>${escapeHtml(eventTime(event.eventTime))}</small>
      </div></article>`;
    }).join('')}</div>` : ''}
    ${pods.length ? `<section class="cp-pod-section"><header><b>Proof of Delivery</b><span>${pods.length} file</span></header><div class="cp-pod-grid">${pods.map(renderPod).join('')}</div></section>` : ''}`;

  card.querySelector<HTMLButtonElement>('[data-cpst-copy]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(button.dataset.cpstCopy || '');
    const label = button.querySelector('b');
    if (label) {
      label.textContent = 'Copied';
      setTimeout(() => { label.textContent = 'Copy'; }, 1200);
    }
  });
}

function updateOrderStatus(root: ParentNode, shipment: Shipment) {
  const state = currentState(shipment);
  const status = root.querySelector<HTMLElement>('.cp-summary .cp-status');
  if (status) {
    status.textContent = state.label;
    status.classList.toggle('success', state.normalized === 'delivered');
  }
}

async function enhanceOrderDetail() {
  const main = document.querySelector<HTMLElement>('main.order-detail-page');
  const orderToken = currentOrderToken();
  if (!main || !orderToken) return;
  const shipment = await shipmentForOrder(orderToken);
  if (!shipment) return;
  const card = main.querySelector<HTMLElement>('.cp-shipment-card');
  if (!card) return;
  renderShipmentCard(card, shipment);
  updateOrderStatus(main, shipment);
}

async function enhanceHistory() {
  const cards = [...document.querySelectorAll<HTMLElement>('.cp-order-card[data-cp-order]')];
  const customerToken = currentCustomerToken();
  if (!cards.length || !customerToken) return;
  const shipments = await shipmentsForCustomer(customerToken);
  for (const card of cards) {
    const shipment = shipments.get(card.dataset.cpOrder || '');
    if (!shipment) continue;
    const state = currentState(shipment);
    const status = card.querySelector<HTMLElement>('.cp-status');
    if (status) {
      status.textContent = state.label;
      status.classList.toggle('success', state.normalized === 'delivered');
    }
    if (shipment.tracking) card.dataset.shipmentTracking = shipment.tracking;
  }
}

async function enhance() {
  if (enhancing) return;
  enhancing = true;
  try {
    await Promise.allSettled([enhanceOrderDetail(), enhanceHistory()]);
  } finally {
    enhancing = false;
  }
}

function scheduleEnhance(delay = 80) {
  window.clearTimeout(enhanceTimer);
  enhanceTimer = window.setTimeout(() => void enhance(), delay);
}

const observer = new MutationObserver(() => scheduleEnhance());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', () => scheduleEnhance());
window.addEventListener('focus', () => scheduleEnhance(0));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleEnhance(0);
});
setInterval(() => {
  if (!document.hidden && (currentOrderToken() || document.querySelector('.cp-order-card'))) {
    const token = currentOrderToken();
    if (token) orderCache.delete(token);
    historyCache = null;
    scheduleEnhance(0);
  }
}, 30_000);

scheduleEnhance(0);
