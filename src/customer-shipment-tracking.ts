import './customer-shipment-tracking.css';

type PodFile = { id: string; position: number; contentType: string; url: string };
type ShipmentEvent = {
  id?: string;
  status: string;
  statusGroup: string;
  normalizedStatus?: string;
  statusLabel?: string;
  event: string;
  eventTime: number;
  location?: string;
};
type Shipment = {
  id: string;
  tracking: string;
  courier: string;
  trackingLink: string;
  connoteUrl: string;
  status: string;
  statusGroup: string;
  normalizedStatus?: string;
  statusLabel?: string;
  updatedAt: number;
  podCount?: number;
  pods?: PodFile[];
  events: ShipmentEvent[];
};
type ShipmentResponse = { orderToken: string; shipment: Shipment | null };

const FALLBACK_URL = 'https://buivecgahhmrhlmfujgt.supabase.co';
const orderCache = new Map<string, { at: number; shipment: Shipment | null }>();
let historyCache: { token: string; at: number; values: Map<string, Shipment | null> } | null = null;
let timer = 0;
let busy = false;

const html = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const key = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const projectUrl = () => {
  const env = (import.meta as any).env || {};
  return String(env.VITE_SUPABASE_URL || env.SUPABASE_URL || FALLBACK_URL).replace(/\/$/, '');
};
const customerToken = () => new URL(location.href).searchParams.get('c') || localStorage.getItem('customer_token') || '';
const orderToken = () => new URL(location.href).searchParams.get('order')
  || (history.state as { orderToken?: string } | null)?.orderToken || '';

function url(value: unknown) {
  try {
    const parsed = new URL(String(value || ''));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch { return ''; }
}

function label(value: unknown) {
  const valueKey = key(value);
  if (['awb_created', 'shipment_created', 'booked'].includes(valueKey)) return 'AWB Created';
  if (valueKey === 'picked_up') return 'Picked Up';
  if (valueKey === 'in_transit') return 'In Transit';
  if (valueKey === 'out_for_delivery') return 'Out for Delivery';
  if (valueKey === 'delivered') return 'Delivered';
  if (valueKey === 'delivery_exception') return 'Delivery Exception';
  if (valueKey === 'returning') return 'Returning';
  if (valueKey === 'cancelled') return 'Cancelled';
  return String(value || 'Shipment Update').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function state(shipment: Shipment) {
  const normalized = key(shipment.normalizedStatus || shipment.statusGroup || shipment.status);
  return { normalized, label: shipment.statusLabel || label(normalized) };
}

function setText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setSuccess(element: HTMLElement | null, enabled: boolean) {
  if (!element) return;
  if (element.classList.contains('success') !== enabled) element.classList.toggle('success', enabled);
}

async function get<T>(params: URLSearchParams): Promise<T> {
  const response = await fetch(`${projectUrl()}/functions/v1/customer-shipment?${params}`, {
    headers: { accept: 'application/json' }, cache: 'no-store',
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Shipment request failed (${response.status})`);
  return body as T;
}

async function one(token: string) {
  const cached = orderCache.get(token);
  if (cached && Date.now() - cached.at < 15_000) return cached.shipment;
  const result = await get<ShipmentResponse>(new URLSearchParams({ order_token: token }));
  orderCache.set(token, { at: Date.now(), shipment: result.shipment || null });
  return result.shipment || null;
}

async function many(token: string) {
  if (historyCache?.token === token && Date.now() - historyCache.at < 15_000) return historyCache.values;
  const result = await get<{ shipments: ShipmentResponse[] }>(new URLSearchParams({ customer_token: token }));
  const values = new Map<string, Shipment | null>();
  for (const item of result.shipments || []) values.set(item.orderToken, item.shipment || null);
  historyCache = { token, at: Date.now(), values };
  return values;
}

function time(value: number) {
  return value ? new Date(value).toLocaleString('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '';
}

function podCard(pod: PodFile, index: number) {
  const podUrl = url(pod.url);
  if (!podUrl) return '';
  const image = String(pod.contentType || '').startsWith('image/');
  return `<a class="cp-pod-item" href="${html(podUrl)}" target="_blank" rel="noopener">
    ${image ? `<img src="${html(podUrl)}" alt="Proof of Delivery ${index + 1}" loading="lazy">` : '<span>📄</span>'}
    <b>POD ${index + 1}</b></a>`;
}

function renderCard(card: HTMLElement, shipment: Shipment) {
  const current = state(shipment);
  const signature = [shipment.id, shipment.updatedAt, shipment.podCount, shipment.events?.length].join(':');
  if (card.dataset.shipmentSignature === signature) return;
  card.dataset.shipmentSignature = signature;

  const trackUrl = url(shipment.trackingLink);
  const awbUrl = url(shipment.connoteUrl);
  const pods = shipment.pods || [];
  card.classList.add('cp-shipment-enhanced');
  card.innerHTML = `<header class="cp-shipment-head"><div>
      <small>${html(shipment.courier || 'Courier')}</small><h3>${html(current.label)}</h3>
      <span>${html(shipment.status || current.label)}</span></div>
      <div class="cp-shipment-links">
        ${trackUrl ? `<a href="${html(trackUrl)}" target="_blank" rel="noopener">Track Parcel</a>` : ''}
        ${awbUrl ? `<a href="${html(awbUrl)}" target="_blank" rel="noopener">View AWB</a>` : ''}
      </div></header>
    ${shipment.tracking ? `<button class="cp-tracking-copy" data-cpst-copy="${html(shipment.tracking)}"><span>${html(shipment.tracking)}</span><b>Copy</b></button>` : ''}
    ${shipment.events?.length ? `<div class="cp-shipment-timeline">${shipment.events.map((event, index) => {
      const normalized = event.normalizedStatus || event.statusGroup || event.status;
      const eventLabel = event.statusLabel || label(normalized);
      return `<article class="${index === 0 ? 'latest' : ''}"><i></i><div><b>${html(eventLabel)}</b>
        ${event.status && key(event.status) !== key(eventLabel) ? `<span>${html(event.status)}</span>` : ''}
        ${event.location ? `<span>📍 ${html(event.location)}</span>` : ''}<small>${html(time(event.eventTime))}</small></div></article>`;
    }).join('')}</div>` : ''}
    ${pods.length ? `<section class="cp-pod-section"><header><b>Proof of Delivery</b><span>${pods.length} file</span></header>
      <div class="cp-pod-grid">${pods.map(podCard).join('')}</div></section>` : ''}`;

  card.querySelector<HTMLButtonElement>('[data-cpst-copy]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    await navigator.clipboard.writeText(button.dataset.cpstCopy || '');
    const copy = button.querySelector('b');
    setText(copy, 'Copied');
    setTimeout(() => setText(copy, 'Copy'), 1200);
  });
}

async function enhanceOrder() {
  const main = document.querySelector<HTMLElement>('main.order-detail-page');
  const token = orderToken();
  if (!main || !token) return;
  const shipment = await one(token);
  if (!shipment) return;
  const card = main.querySelector<HTMLElement>('.cp-shipment-card');
  if (card) renderCard(card, shipment);
  const current = state(shipment);
  const status = main.querySelector<HTMLElement>('.cp-summary .cp-status');
  setText(status, current.label);
  setSuccess(status, current.normalized === 'delivered');
}

async function enhanceHistory() {
  const cards = [...document.querySelectorAll<HTMLElement>('.cp-order-card[data-cp-order]')];
  const token = customerToken();
  if (!cards.length || !token) return;
  const shipments = await many(token);
  for (const card of cards) {
    const shipment = shipments.get(card.dataset.cpOrder || '');
    if (!shipment) continue;
    const current = state(shipment);
    const signature = `${shipment.id}:${shipment.updatedAt}:${current.normalized}`;
    if (card.dataset.shipmentState === signature) continue;
    card.dataset.shipmentState = signature;
    const status = card.querySelector<HTMLElement>('.cp-status');
    setText(status, current.label);
    setSuccess(status, current.normalized === 'delivered');
    if (shipment.tracking && card.dataset.shipmentTracking !== shipment.tracking) {
      card.dataset.shipmentTracking = shipment.tracking;
    }
  }
}

async function enhance() {
  if (busy) return;
  busy = true;
  try { await Promise.allSettled([enhanceOrder(), enhanceHistory()]); }
  finally { busy = false; }
}

function schedule(delay = 80) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void enhance(), delay);
}

new MutationObserver(() => schedule()).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('popstate', () => schedule());
window.addEventListener('focus', () => schedule(0));
document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(0); });
setInterval(() => {
  if (document.hidden || (!orderToken() && !document.querySelector('.cp-order-card'))) return;
  const token = orderToken();
  if (token) orderCache.delete(token);
  historyCache = null;
  schedule(0);
}, 30_000);

schedule(0);
