import { supabase } from '@appdeploy/client';
import './shipping-dashboard.css';

type PodItem = {
  id: string;
  position: number;
  content_type: string;
  size_bytes: number;
  status: string;
  archived_at?: string;
  view_url: string;
};

type ShipmentEvent = {
  status?: string;
  status_group?: string;
  normalized_status?: string;
  event_name?: string;
  event_time?: string;
  location?: string;
  description?: string;
};

type ShippingDashboard = {
  success: boolean;
  shipment?: {
    courier?: string;
    tracking_no?: string;
    tracking_link?: string;
    status?: string;
    status_group?: string;
    normalized_status?: string;
    booked_at?: string;
    shipped_at?: string;
    delivered_at?: string;
    pod_count?: number;
    proof_of_delivery_available?: boolean;
  };
  events?: ShipmentEvent[];
  pod?: PodItem[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let timer = 0;
let historyLoadedFor = '';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(value?: string) {
  return String(value || 'Shipment created').replaceAll('_', ' ');
}

function showPodImage(url: string, position: number) {
  const modal = document.createElement('div');
  modal.className = 'pod-lightbox';
  modal.innerHTML = `
    <button class="pod-lightbox-close" aria-label="Close">×</button>
    <figure>
      <img src="${escapeHtml(url)}" alt="Proof of delivery ${position}" referrerpolicy="no-referrer">
      <figcaption>Proof of Delivery ${position}</figcaption>
    </figure>`;
  document.body.append(modal);
  const close = () => modal.remove();
  modal.querySelector<HTMLButtonElement>('.pod-lightbox-close')!.onclick = close;
  modal.onclick = (event) => { if (event.target === modal) close(); };
}

function renderShipmentPanel(data: ShippingDashboard) {
  const shipment = data.shipment;
  if (!shipment) return '';
  const events = Array.isArray(data.events) ? data.events : [];
  const pods = Array.isArray(data.pod) ? data.pod : [];
  const state = shipment.normalized_status || shipment.status_group || shipment.status;
  const delivered = String(state || '').toLowerCase() === 'delivered';
  const timeline = events.length
    ? events.map((event) => `
      <li class="shipping-timeline-item ${String(event.normalized_status || '').toLowerCase() === 'delivered' ? 'is-delivered' : ''}">
        <i></i>
        <div>
          <b>${escapeHtml(statusLabel(event.normalized_status || event.status_group || event.status))}</b>
          ${event.description ? `<p>${escapeHtml(event.description)}</p>` : ''}
          <small>${escapeHtml(displayDate(event.event_time))}${event.location ? ` · ${escapeHtml(event.location)}` : ''}</small>
        </div>
      </li>`).join('')
    : '<li class="shipping-empty">Tracking events belum diterima.</li>';

  const gallery = pods.length
    ? `<div class="pod-section">
        <div class="pod-heading"><div><b>Proof of Delivery</b><span>${pods.length} gambar disimpan</span></div><em>✓ Archived</em></div>
        <div class="pod-grid">
          ${pods.map((pod) => `<button type="button" data-pod-url="${escapeHtml(pod.view_url)}" data-pod-position="${pod.position}">
            <img src="${escapeHtml(pod.view_url)}" alt="Proof of delivery ${pod.position}" loading="lazy" referrerpolicy="no-referrer">
            <span>Gambar ${pod.position}</span>
          </button>`).join('')}
        </div>
      </div>`
    : delivered
      ? '<div class="pod-pending">Parcel delivered. Proof of delivery sedang diproses.</div>'
      : '';

  return `<section class="order-detail-card shipment-dashboard-card" data-shipping-dashboard>
    <div class="shipment-dashboard-head">
      <div><h3>Shipment Tracking</h3><p>${escapeHtml(shipment.courier || 'Courier')} · ${escapeHtml(shipment.tracking_no || 'Tracking pending')}</p></div>
      <span class="shipment-live-status ${delivered ? 'is-delivered' : ''}">${escapeHtml(statusLabel(state))}</span>
    </div>
    ${shipment.tracking_link ? `<a class="shipment-track-link" href="${escapeHtml(shipment.tracking_link)}" target="_blank" rel="noopener noreferrer">Open Courier Tracking ↗</a>` : ''}
    <ol class="shipping-timeline">${timeline}</ol>
    ${gallery}
  </section>`;
}

async function enhanceOrderPage() {
  const page = document.querySelector<HTMLElement>('.order-detail-page');
  const orderNo = page?.querySelector<HTMLElement>('.order-status-hero h2')?.textContent?.trim();
  if (!page || !orderNo || page.dataset.shippingOrder === orderNo) return;
  page.dataset.shippingOrder = orderNo;

  const rawCustomerId = localStorage.getItem('customer_token') || '';
  const customerId = uuidPattern.test(rawCustomerId) ? rawCustomerId : null;
  const orderToken = new URLSearchParams(location.search).get('order');
  if (!customerId && !orderToken) return;

  const { data, error } = await supabase.rpc('icetak_customer_order_dashboard_access', {
    p_order_no: orderNo,
    p_customer_id: customerId,
    p_order_token: orderToken,
  });
  if (error || !data?.success || !data.shipment) return;

  page.querySelector('[data-shipping-dashboard]')?.remove();
  const actions = page.querySelector('.order-detail-actions');
  const holder = document.createElement('div');
  holder.innerHTML = renderShipmentPanel(data as ShippingDashboard);
  const panel = holder.firstElementChild;
  if (!panel) return;
  if (actions) actions.before(panel); else page.append(panel);
  panel.querySelectorAll<HTMLButtonElement>('[data-pod-url]').forEach((button) => {
    button.onclick = () => showPodImage(button.dataset.podUrl || '', Number(button.dataset.podPosition || 1));
  });
}

async function enhanceHistoryPage() {
  const history = document.querySelector<HTMLElement>('.history-page');
  const rawCustomerId = localStorage.getItem('customer_token') || '';
  if (!history || !uuidPattern.test(rawCustomerId)) return;
  const key = `${rawCustomerId}:${history.querySelectorAll('.order-card').length}`;
  if (historyLoadedFor === key) return;
  historyLoadedFor = key;

  const { data, error } = await supabase.rpc('icetak_customer_orders_dashboard_access', {
    p_customer_id: rawCustomerId,
  });
  if (error || !data?.success || !Array.isArray(data.orders)) return;
  const shipments = new Map<string, any>(data.orders.map((order: any) => [String(order.order_no), order]));

  history.querySelectorAll<HTMLElement>('.order-card').forEach((card) => {
    const orderNo = card.querySelector<HTMLElement>('.order-card-head b')?.textContent?.trim() || '';
    const shipping = shipments.get(orderNo);
    if (!shipping || card.querySelector('.history-shipment-badge')) return;
    const badge = document.createElement('div');
    badge.className = 'history-shipment-badge';
    const status = statusLabel(shipping.normalized_status || shipping.shipment_status_group || shipping.shipment_status);
    badge.innerHTML = `<span>🚚 ${escapeHtml(status)}</span>${shipping.proof_of_delivery_available ? '<em>📷 Proof available</em>' : ''}`;
    card.querySelector('.order-card-foot')?.before(badge);
  });
}

function scheduleEnhancement() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    void enhanceOrderPage();
    void enhanceHistoryPage();
  }, 80);
}

new MutationObserver(scheduleEnhancement).observe(document.body, { childList: true, subtree: true });
window.addEventListener('popstate', scheduleEnhancement);
scheduleEnhancement();
